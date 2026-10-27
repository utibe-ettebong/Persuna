# PERSUNA

Train a personal AI agent on how you actually do your work, from your own before-and-after examples. The agent drafts, you approve, and every correction makes the next draft closer to yours.

This repository is the hackathon build. The first skill is turning raw meeting notes into finished minutes.

## Pages

- `/`: the public landing page (open without the app password).
- `/sign-in`, `/sign-up`: accounts (email and password, via [Better Auth](https://www.better-auth.com)).
- `/persona`: your assistant's profile, what it remembers, coaching on your skills, to-dos and notes.
- `/personas/<handle>`: a persona's public profile (open to anyone): listed skills, scores, renters, reviews.
- `/companion`: the companion on its own page (used by the desktop app).
- `/skills`, `/jobs`, `/market`, `/earnings`, `/audit`: the studio, for signed-in users. Each person sees only their own skills, jobs, earnings and activity; renters see their own orders. Admins (`ADMIN_EMAILS`) see everything and the Models & keys page.
- `/approvals/<token>`: an employer's approval link (open; the token is the credential).

The design follows a framed, rule-drawn system: an off-white page inside vertical rules, mono uppercase labels and buttons (DM Mono), display type in Instrument Sans, one purple brand colour, plum bands, and diagonal hatching in empty space. Tokens live in `src/app/globals.css`; shared pieces are in `src/components/ui.tsx` and `src/components/brand.tsx`.

## What works

**Persona, your assistant** (the avatar in the corner of every studio page)

- **Its own character, hovering over the page.** Persona is a living drop (pick its look: Plum, Aurora, Ember, Lagoon, Moss, Ink) that breathes, follows your cursor with its eyes, blinks, ripples with your voice while listening, swirls while thinking, moves its mouth while talking, and dozes when you leave. Drag it anywhere. Its words float beside it as captions; open it and the conversation flows above it with no panel around it. In Chrome, the float button pops it into a window above your other apps.
- **It talks back.** Replies are spoken aloud by default (the most natural voice the browser has; long replies speak the first few sentences). The wave button starts a **hands-free conversation**: it listens, notices when you stop speaking, transcribes, answers out loud, and listens again. It doesn't listen while it's talking, so it won't hear itself.
- Once a day it asks what you're working on. Tell it ("I'm working on the board minutes") and it sets today's focus and links it to your matching skill.
- "Take a note: …" saves a note; "Remember that …" saves a fact it uses in later conversations. Both are on the _Persona_ page, where you can delete notes, make it forget facts, rename it and change its avatar.
- **Training by conversation:** say "teach me" and it asks the skill's interview questions one at a time, saving each answer to the skill. State a rule ("I always put decisions in bold") and it becomes a proposed rule change you review, with names and identifiers removed first.
- **First meeting:** the first time, it opens by itself and asks what to call it, how it should look, and which task to learn first (an existing skill, a new one, or the sample). That task becomes today's focus.
- **Work from the chat:** "Turn these notes into minutes" (or 📎) opens a small form: pick a published skill, paste the input or upload a file, and it drafts the result as a normal owner job. Approve, edit or send it back right in the chat. The input and draft stay in `jobs` (purged after retention); the chat only records that a task ran.
- **Reminders and to-dos:** "Remind me at 4pm to send the minutes" or "in 20 minutes", or "todo: book the room". Times are the user's local time. Due reminders show in the chat, are read aloud if 🔊 is on, and appear as browser notifications once allowed. Manage them on the _Persona_ page.
- **Coaching:** "How is my minutes skill doing?" gives where it stands and the next step to a listing, e.g. its score against `LISTING_MIN_SCORE` with a rough number of examples to add. The _Persona_ page shows this for every skill. The estimate is a rule of thumb (`src/lib/persona/coach.ts`) and says so.
- **End-of-day wrap-up:** after 5pm it offers once; or say "wrap up my day". Built from what actually happened (focus, tasks drafted and approved, notes, done and open to-dos), with no model call.
- **Public profile:** every persona gets `/personas/<handle>` with its listed skills, scores, trust level, how many people rented it in the last 30 days, and renters' ratings. Marketplace cards link to it. Never the owner's notes, memory or chats.
- **Watching, only with permission:** "Watch my screen" explains what happens, then asks you to share one window. It looks every 30 seconds, only when the window has changed (at most 40 looks a session), and writes the steps it sees into a note. Screenshots are never stored. When you stop, "Teach it" sends those steps to the focus skill. Without permission it just sits there. The browser's picker can share any app's window (Figma, a video editor), and **Persona Desktop** (`desktop/`, see its README) keeps the companion in a small always-on-top window beside those apps.

**Train a skill** (Skills → a skill)

1. **Name the task:** _New skill_ form.
2. **Interview, voice and screen:** on the _Interview_ tab, answer seven questions about how you do the task, record a voice walkthrough, or record a **screen walkthrough**: share one window, do the task once while narrating, review the captured frames (delete any you don't want sent), then send. The model describes your method from the frames and narration, names and numbers are redacted, and frames and audio are discarded. Before any rules exist, all of this feeds rule extraction; afterwards it becomes proposed rule changes.
3. **Add examples:** paste or upload (.md, .txt, .docx) before-and-after pairs on the _Examples_ tab, and mark each one for training or testing. Every pair is scanned for emails, phone and account numbers, links and street addresses (patterns), and for people, organisations and places (the model). Names get numbered placeholders shared across the pair's input and output: "Ada" is `[PERSON 1]` in both. You choose between saving with placeholders and confirming the data is invented.
4. **Extract rules:** one model call turns the training pairs into a plain-language skill sheet (v1).
5. **Edit rules:** on the _Edit rules_ tab, change, add or remove rules and the output template. Saving creates a new version.
6. **Test:** each held-back input is drafted using the sheet and the 3 closest training examples. The draft is then scored against your real version, which gives the replication score. Drafts and your versions are shown side by side with the differences marked.
7. **Correct:** edit a draft. Your edit becomes **proposed** rule changes, which you accept (creating a new version and re-running the tests) or reject.
8. **Publish:** pick the version real jobs use. A version must have a test run. If it scores lower than the published one, publishing is blocked until you tick that you've reviewed it. Publishing resets the trust level to 0.

**Do real work** (Jobs)

- Submit an input (paste, upload, or record a voice note that is transcribed). It is drafted with the _published_ version.
- **Self-check:** before you see it, the agent checks its draft against the input and the rules. It flags missing information, invented details, rule conflicts and unusual input, and separately flags numbers in the draft that never appear in the input. Flagged jobs always come to you.
- **Trust levels** (_Trust_ tab): level 0 reviews everything. Level 1 auto-approves unflagged jobs and needs `TRUST_L1_MIN_JOBS` (20) owner-reviewed jobs on the published version, with `TRUST_L1_MIN_CLEAN_PERCENT` (90%) approved unchanged or with minor edits and no complaints. Level 2 spot-checks 1 in `TRUST_SPOT_CHECK_EVERY` (5) and needs `TRUST_L2_MIN_JOBS` (50) jobs at level 1 with none rejected. You climb when you choose and can step down at any time. A new published version or a renter complaint resets to 0.
- Approve as is, edit and approve, or reject. Each approval records the edit size (none, minor up to 15% of words, or major), and the page shows the share approved unchanged or with minor edits.
- Download the approved result as .docx or .md.
- _Teach the skill from your edit_: proposes rule changes from a job edit. Only the rule changes and your reason are stored, never the client's text.
- Jobs are deleted after `JOB_RETENTION_DAYS` (30 by default).

**Rent it out** (skill → Listing, Marketplace, Earnings)

- A listing has a price, turnaround, sample output, owner type and an ownership declaration. It can only go live with a published version that scores at least `LISTING_MIN_SCORE` (80 by default) and with ownership declared.
- **Employer approval:** an employee listing names their employer and gets a private approval link (`/approvals/<token>`, open without the app password). The employer approves and sets their share of earnings, or declines. The listing can't go live until approved, and changing the employer starts the approval again.
- Owners can offer **guaranteed owner review** for an extra fee. Those jobs always come to the owner, whatever the trust level.
- Renters submit a task with their email. The listing shows the trust level ("owner-reviewed" or "auto-approved"). The owner reviews the draft like any other job, unless trust allows auto-approval. The renter sees only the approved result (rendered, plus .docx), then accepts and rates it, which releases the payment minus `PLATFORM_FEE_PERCENT` (20% by default) and any employer share. If the owner rejects the job, or the renter reports a problem, the renter is refunded and a complaint resets trust to 0.
- **Payments:** `PAYMENTS_PROVIDER=mock` (the default) records payments without moving money. `PAYMENTS_PROVIDER=paystack` with `PAYSTACK_SECRET_KEY` and `APP_URL` sends renters to Paystack checkout. Payments are verified with Paystack's API (from the return redirect and from the signed webhook at `/api/webhooks/paystack`) before any work starts, and refunds go back through Paystack. Payouts to owners and employers are recorded on the Earnings page and settled from the Paystack dashboard; automatic transfers are not built.
- **Audit log** (_Audit log_ in the nav, and each skill's _Activity_ tab): every skill change, proposal, publish, trust change, job decision, listing change, employer decision and payment event, with who and when. It never stores job text.

### Demo setup

`npm run demo:seed -- --owner you@example.com` (an account that has signed up) loads the sample meeting-minutes skill (4 training and 2 test pairs, all invented), extracts rules, runs the tests, publishes v1 and puts a listing live in the marketplace. It is safe to run more than once. On Railway, run it inside the service with `railway ssh --service Persuna -- npm run demo:seed -- --owner you@example.com`.

**Key slots:** values that start with `PASTE_`, `REPLACE_`, `ADD_`, `YOUR_`, `TODO_` or `CHANGEME_` count as unset. Leave such placeholders in Railway as visible slots; the app stays on mock models until a real `EXTRACT_API_KEY` is pasted. A role (`DRAFT_*`, `EVAL_*`, `TRANSCRIBE_*`) uses its own settings only once it has its own real key; until then it borrows `EXTRACT_*` as a whole set, so a Baseten URL is never sent a Meta key. The studio's **Models & keys** page (`/settings`) shows what each role is using, never the keys themselves.

### Mock models

With no `EXTRACT_API_KEY` set, the app runs **offline mock models**, and a banner says so. They read the same prompts and run through the same engine, so every screen works without keys. Their drafts are rough. They follow header-label and "Always include" rules, so corrections visibly move the score. Their scores are word and section overlap, not judgement. Set the keys (or `MODEL_PROVIDER=live`) to switch to real models; `MODEL_PROVIDER=mock` forces the mock.

## Stack

| Layer               | Choice                                                                         |
| ------------------- | ------------------------------------------------------------------------------ |
| App (UI and server) | Next.js 16 (App Router, server actions), TypeScript, Tailwind CSS 4            |
| Database            | Postgres via Drizzle ORM; migrations in `drizzle/`                             |
| Models              | A thin gateway over OpenAI-compatible chat-completions endpoints, one per role |
| Validation          | Zod for env, model output and form input                                       |
| Tests               | Vitest                                                                         |
| Hosting             | Railway (web service plus Postgres), configured in `.railway/railway.ts`       |

| Role       | Used for                                               | Intended model              |
| ---------- | ------------------------------------------------------ | --------------------------- |
| `extract`  | Rule extraction; turning corrections into rule changes | Muse Spark (Meta Model API) |
| `draft`    | Drafting outputs                                       | Muse Spark Open on Baseten  |
| `evaluate` | Scoring drafts against held-back examples              | Muse Spark Open on Modal    |

> Before you rely on these roles, check the provider docs: confirm the exact model IDs and that each endpoint accepts OpenAI-style `POST {base}/chat/completions` requests. If one doesn't, add an adapter in `src/lib/models/gateway.ts`. Nothing else needs to change.

## Layout

```
data/skills/meeting-minutes/     skill.json + pairs/train and pairs/test (*.input.md / *.output.md)
drizzle/                         generated SQL migrations (commit these)
scripts/skill.ts                 CLI for the training loop
scripts/migrate.mjs              applies migrations (Railway pre-deploy)
src/lib/skill/engine.ts          the loop itself, with no storage: extract, draft, score, correct
src/lib/skill/service.ts         skills, pairs, versions, test runs, corrections, publishing (Postgres)
src/lib/skill/prompts.ts         every prompt in one place
src/lib/skill/redact.ts          identifier scan for example pairs
src/lib/persona/                 the assistant: brain (no storage), service, types
src/components/persona/          the on-screen companion, setup, task runner, screen watcher, Persona page pieces
desktop/                         Persona Desktop: Electron shell around /companion
src/lib/jobs/                    real jobs: draft, review, edit size, retention
src/lib/market/                  listings, rent, mock escrow, payouts
src/lib/docs/                    .docx export and .md/.txt/.docx upload reading
src/lib/models/gateway.ts        live model client: retries, timeouts, usage tracking
src/lib/models/mock.ts           offline mock models
src/app/actions/                 server actions (skills, jobs, market)
src/app/(site)/                  public pages: landing, employer approvals
src/app/(studio)/                studio pages: skills, examples, rules, runs, corrections, jobs, market, earnings, audit
src/lib/auth/                    accounts (Better Auth), sessions, ownership checks
src/proxy.ts                     sends signed-out visitors to /sign-in
```

The overall score is computed in code from the evaluator's five criterion scores (structure, content, cuts, tone, naming), using the weights in `src/lib/skill/score.ts`. That keeps scores comparable across versions. Example retrieval uses deterministic TF-IDF similarity, so a score changes only when the rules change.

## Run locally

Requires Node 22.12+ and a Postgres database.

```bash
npm install
cp .env.example .env            # set DATABASE_URL; leave EXTRACT_* empty to use mock models
createdb persuna
npm run db:migrate
npm run skill -- import         # loads data/skills/meeting-minutes
npm run dev                     # http://localhost:3000 (landing), /skills (studio)
```

### Training loop from the terminal

```bash
npm run skill -- extract        # v1 from the training pairs
npm run skill -- test           # draft + score the held-back pairs; prints result ids
npm run skill -- correct --result <id> --file my-edit.md --reason "We never abbreviate names"
                                # proposes rule changes; add --yes to accept and re-test
npm run skill -- publish        # publish the working version (--version N, --yes to accept a lower score)
npm run skill -- report         # score per version (* working, P published)
```

The UI does the same steps through the same functions.

## Adding your pairs

See [data/skills/meeting-minutes/README.md](data/skills/meeting-minutes/README.md). **The repository is public**, so use only invented or fully anonymised meetings. Delete the `sample-*` pairs once yours are in.

## Deploy to Railway

The project is defined as code in `.railway/railway.ts`: a `web` service built with Railpack and a `postgres` database. Migrations run as the pre-deploy command, and `/api/health` is the healthcheck. Railway's older `railway.json` config isn't supported for new services, so don't add one.

```bash
railway login
railway link                    # or create a project in the dashboard first
railway config plan             # preview
railway config apply
```

Then set secrets on the `web` service. They are never committed: `preserve()` in the config keeps whatever you set in Railway.

```bash
railway variable set --service web EXTRACT_BASE_URL=... EXTRACT_MODEL=...
railway variable set --service web --stdin EXTRACT_API_KEY   # paste the key, keeps it out of shell history
railway variable set --service web --stdin BETTER_AUTH_SECRET   # openssl rand -base64 32
railway variable set --service web ADMIN_EMAILS=you@example.com
```

Add `DRAFT_*` and `EVAL_*` the same way when those endpoints are ready. Until then, the drafting and evaluation steps use the `EXTRACT_*` settings. Generate a public domain in the service's **Networking** settings. Load your pairs into the Railway database from your machine with `railway run npm run skill -- import`.

In production the app won't start without `BETTER_AUTH_SECRET`. Sign-ups are open unless `AUTH_ALLOWED_EMAILS` lists allowed emails or `@domains`; since every action can spend model credits, set it before sharing the link widely.

## Checks

```bash
npm run check                   # lint, typecheck, format check, tests
npm run build
```

CI runs the same checks on every push and pull request (`.github/workflows/ci.yml`).

## Not in this build yet

Email verification and password reset (they need an email provider). Sign-in with Google. Automatic payouts by Paystack transfer, plus Flutterwave and Stripe. Sending the employer link by email (you copy it from the Listing tab). WhatsApp and email delivery. Isolated job sandboxes. See the concept document for the full design.

**Voice:** the browser converts every recording and upload to 16 kHz mono WAV. With a base URL on `api.meta.ai`, transcription uses Muse Voice Transcribe's native API (`/v1/asr/transcribe`); anything else uses OpenAI-style `/audio/transcriptions`. Override with `TRANSCRIBE_API=meta|openai`. Recordings are capped at 5 minutes.

**To verify before relying on it:** the webhook check uses Paystack's documented scheme (HMAC-SHA512 of the raw body with your secret key, in `x-paystack-signature`), but it couldn't be checked against Paystack's docs page during the build. Test it with a test-mode key.

## License

MIT
