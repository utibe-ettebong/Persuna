# PERSUNA

Train a personal AI agent on how you actually do your work, from your own before-and-after examples. The agent drafts, you approve, and every correction makes the next draft closer to yours.

This repository is the hackathon build. The first skill is turning raw meeting notes into finished minutes.

## Pages

- `/`: the public landing page (open without the app password).
- `/sign-in`, `/sign-up`: accounts (email and password, via [Better Auth](https://www.better-auth.com)).
- `/persuna`: My Persuna, your assistant's profile, what it remembers, coaching on your skills, to-dos and notes.
- `/download`: Persuna Desktop for Mac and Windows (open to anyone). Each button is a `/download/<mac-arm64|mac-x64|win-x64|win-arm64>` link that starts the newest installer from the latest GitHub release, so visitors never see the release page. From 0.7.0 the app **updates itself**: it checks at launch and every 4 hours, downloads in the background, and installs when Persuna restarts or quits (menu bar: _Restart to update_). Windows uses electron-updater; on a Mac, which needs an Apple Developer ID for Squirrel, `desktop/updater.js` downloads the zip for the Mac's chip, checks its SHA-512 against `latest-mac.yml`, and swaps the app bundle after Persuna quits. A copy run from the disk image or a folder it can't write to says where to download instead.
- `/persunas/<handle>`: a persuna's public profile (open to anyone): listed skills, scores, renters, reviews.
- `/companion`: the companion on its own page (used by the desktop app).
- `/skills`, `/jobs`, `/market`, `/earnings`, `/audit`: the studio, for signed-in users. Each person sees only their own skills, jobs, earnings and activity; renters see their own orders. Admins (`ADMIN_EMAILS`) see everything and the Models & keys page.
- `/approvals/<token>`: an employer's approval link (open; the token is the credential).
- `/team`: Persuna for teams: your organisation, roles, handbook, people and onboarding (`/team/join/<token>` accepts an invitation).

The design follows a framed, rule-drawn system: an off-white page inside vertical rules, mono uppercase labels and buttons (DM Mono), display type in Instrument Sans, one purple brand colour, plum bands, and diagonal hatching in empty space. Tokens live in `src/app/globals.css`; shared pieces are in `src/components/ui.tsx` and `src/components/brand.tsx`.

## What works

**Persuna, your assistant** (the avatar in the corner of every studio page)

- **A dashboard to start from.** Signing in lands on _Dashboard_: what needs you now (results to review, proposals to choose from, deliveries to check or make, milestones to fund, paused listings, imported skills ready to list, to-dos due), money earned, released in the last 30 days and held in escrow, earnings per week for eight weeks, your skills with their scores and marketplace status, each project's next step (as client or seller), the skills you've rented, and imports from your other agents. Rules: `src/lib/dashboard/rules.ts`.
- **Public profiles with a portfolio.** Everyone gets a profile at `/persunas/<handle>`: the name, headline, bio, location and website they choose (never their email), portfolio pieces they write themselves (title, what they did, an https link and picture), the skills they rent out with Persuna's scores, and reviews from renters, from clients on projects they delivered, and from sellers on projects they posted. Project pages link the client and each seller to their profile. Edit it under the account menu → _Edit profile and portfolio_.
- **Its own character, hovering over the page.** Persuna is a living drop (pick its look: Plum, Aurora, Ember, Lagoon, Moss, Ink) that breathes, follows your cursor with its eyes, blinks, ripples with your voice while listening, swirls while thinking, moves its mouth while talking, and dozes when you leave. Drag it anywhere. There is no chat box: its words show beside it for a moment while it speaks, and a card appears only when it needs a decision (approve a draft, an example, publishing). Right-click it for the rest (type instead, watch my screen, mute, conversation and notes). The full conversation is on _My Persuna_.
- **Persuna Desktop: hold to talk, from any app.** Persuna lives on the Mac's notch as a small island (its orb on one side, what it's doing on the other); on Windows and Macs without a notch it hangs from the top centre. When you talk or type, it reads your screen **on your computer**: `persuna-eyes` (desktop/native) lists the front app's buttons, fields, links and text from the accessibility tree (UI Automation on Windows) and, on a Mac, every line of text Apple's on-device recognition finds, each with its exact place. Muse Spark gets that short list instead of a picture (about 2 s instead of 2.5–14 s in tests); the screenshot goes too only when the list is thin (a photo, a canvas) or you ask how something looks, or when Muse Spark asks for a closer look. When you ask where something is or what needs your attention, it points: a glowing outline around the exact element, from the list, or found by SAM 3.1 in the screenshot when it isn't listed. Switch looking off from its menu. Persuna shows in your own screenshots. **Hold right ⌥** (right Alt on Windows), speak, and let go: the island shows Listening, then Thinking, then the reply, growing down from the notch. In Work mode that moves to the dot by your cursor instead, and the island stays a silent strip (it still opens for the panel, permissions and decision cards). **Tap it twice** to type. Click the island for Persuna itself: what it's on, the last thing said, and a row of icons (type, circle something, hand it a file, Work mode, wrap up); click anywhere else to close it. **⌃⌥C** (Ctrl+Alt+C) circles something: draw a loop around it and ask. Persuna asks for nothing at launch: when you first use something that needs the Mac's permission (the microphone, Screen Recording, Accessibility), the island says so with an Allow button. Drawings appear straight on the screen, step by step as Persuna explains them. Everything that comes out of the island is solid black, and on a Mac it's a panel, so it also shows over full-screen apps. Persuna can **copy** text for you (what you've selected, or something on screen) and **paste** it where your cursor is in any app (⌘V pressed for you, with Accessibility); **draw** over the screen (numbered notes on what to click, in order, and diagrams of a flow); **make files** you can preview, copy and save (documents as PDF or Markdown, tables as CSV, diagrams as PNG or SVG); and **read files** you hand it (pictures, PDFs, Word and text files, read for that message only). **Work mode** (off until you turn it on, by the island or by saying "turn on work mode"; on the desktop it's also what "watch my screen" means) keeps an eye on what you're doing every few seconds when the screen changes, using the on-device list, not screenshots: usually it stays quiet and learns your steps into a daily "Work mode" note; when you seem stuck or keep searching it gives one pointer and shows where to click; when it could do the next bit (with your skills or apps) it offers, and does it only if you say so. It also asks now and then how or why you do something, explains things on screen you seem unsure of, notices when the work belongs to another of your skills (and offers to switch), and every few steps offers to teach what it learned to today's skill. It goes quiet for a minute after speaking up, and for 20 seconds after you talk to it. Setup lets you pick several skills to start with, from a list or your own. The key can be changed or turned off from the menu bar menu. A system-wide key listener (`uiohook-napi`, which needs Accessibility on a Mac) reacts to that one key only. The first run is a setup window: sign in through your browser (a one-time token comes back on a `persuna://` link, accepted only with the state the app chose) or in the window; allow the microphone, Accessibility and Screen Recording, each with its reason and a drag-me tile for System Settings' lists; a mic test with a picker; practising hold-to-talk; Persuna's name and look; four questions about your work (kept in its memory, setting your focus and tone); and a first skill suggested from what takes you the most time. It can open at login.
- **Call it and talk.** Tap Persuna, or press **⌃⌥P** (Ctrl+Alt+P on Windows) on any page, and it chimes and listens hands-free: it notices when you stop speaking (a one-second pause), transcribes, answers out loud and listens again, until 45 seconds pass with nobody talking. Press again, or tap it, to stop it mid-sentence. Each reply is spoken in one streamed take from the cloud voice (ElevenLabs or an OpenAI-style `/audio/speech`), so it starts within a moment and has no gaps; without a cloud voice the browser's voice speaks. Talking and typing are both always there: on a page, the **Type** button under Persuna opens a message box. Persuna Desktop goes further (below).
- **Two ways to hear you** (`VOICE_MODE`). _listen_ (default): your recording goes straight to Muse Spark, which writes down what you said and answers in the same call (about 4 s), with no separate transcription; if it can't, Persuna transcribes and answers instead. _agent_: ElevenLabs Agents handles the call (listening, knowing when you've finished, talking over it, the voice) while every answer still comes from Persuna's server and Muse Spark, through `/api/persuna/llm`; that's the quickest. Set it up once with `npm run voice:agent` (needs `SPEECH_API=elevenlabs`, `APP_URL` and `ELEVENLABS_LLM_SECRET`), then set `ELEVENLABS_AGENT_ID`. With both available, right-click Persuna to switch.
- **Structured replies use JSON mode** (`response_format: json_object`, which Meta and Baseten both support), falling back to asking in words if a provider refuses it.
- **If a model rejects its key**, that call is redone on the EXTRACT model and the role uses EXTRACT for 10 minutes (logged), so one bad key degrades quality instead of breaking the app.
- **A natural cloud voice.** Set `SPEECH_API_KEY` (OpenAI-compatible `/audio/speech`, default `gpt-4o-mini-tts` voice `nova`, or ElevenLabs with `SPEECH_API=elevenlabs`, or self-hosted Qwen3-TTS on Modal — `modal-voice/README.md`) and Persuna speaks in a human-sounding voice on every machine, in a style that matches how you like to be spoken to. Without a key it uses the browser's voice. Each spoken line counts as one call against the daily allowance.
- **It speaks up.** Every half minute, and whenever you open a page, it checks for things worth saying: a job waiting more than a day ("Your Minutes job has been waiting 2 days"), a skill whose score dropped or rose ("Your Minutes skill dropped to 68"), a new renter order, or the job you're looking at. Each is said once, at most three at a time, and kept in the conversation. Rules: `src/lib/persuna/notices.ts`.
- **Wake word.** Turn on the ear button and say "Hey Nova" (its name) to start talking, or "Hey Nova, remind me at four to call Ada" in one go. It uses the browser's speech recognition (Chrome, Edge, Safari); in Chrome and Edge that audio goes to the browser maker's speech service, and Persuna says so before you turn it on. Off by default, and not available in the desktop app.
- **Memory of tone.** Tell it "keep it short", "be more formal" or "you can joke", or set it on the _My Persuna_ page. Until you choose, it follows how you write (short messages get short replies, emoji get a lighter touch). Both the replies and the cloud voice follow it.
- Once a day it asks what you're working on. Tell it ("I'm working on the board minutes") and it sets today's focus and links it to your matching skill.
- "Take a note: …" saves a note; "Remember that …" saves a fact it uses in later conversations. Both are on the _My Persuna_ page, where you can delete notes, make it forget facts, rename it and change its avatar.
- **Training by conversation:** say "teach me" and it asks the skill's interview questions one at a time, saving each answer to the skill. State a rule ("I always put decisions in bold") and it becomes a proposed rule change you review, with names and identifiers removed first.
- **Build a skill by conversation:** say "I want you to learn writing SEO briefs" and Persuna creates the skill and makes it the focus. "Here's an example" opens a small card for the before and after (text or files); names and identifiers are replaced first, and every few examples one is held back for testing unless you choose. Then "train yourself" extracts the rules, "test yourself" scores them on the held-back examples with a link to the run, and "publish it" shows what would go live and asks you to confirm (and to confirm again if the score is lower than the live version's). After each step it says the next one. The Skills pages still do all of this by hand.
- **Staying on the skill:** if you ask for something that matches another of your skills ("turn these notes into minutes" while you're on SEO briefs), or the screen it's watching shows other work, Persuna asks once whether to switch, with Switch and Stay buttons. Other requests are just answered: it is still your assistant.
- **First meeting, by conversation:** no form. Persuna introduces itself and asks, one question at a time, what to call it, how it should look and what to learn first; answer by typing or by talking ("let's call you Kemi", "something green", "writing SEO briefs for clients"). Tappable shortcuts appear for looks and your skills. The parsing is in `src/lib/persuna/onboarding.ts`.
- **It moves around.** Persuna glides to what it's talking about (a waiting job's link), hovers beside the field you're typing in, glances at each new page's heading, now and then wanders along the edges of the screen, and flies back home. Drag it anywhere to set its home. "Show me my jobs", "open the marketplace" or "open my minutes skill" and it takes you there. Wandering is off with reduced motion.
- **Interrupt it, and it interrupts you.** In a hands-free conversation, start talking while Persuna speaks and it stops to listen; tapping it or typing also stops it. Persuna cuts in too: if a reminder comes due mid-sentence, or you talk for over 25 seconds, it says "Sorry to cut in" and keeps what you said so far.
- **It works in your apps.** Connect Gmail and Google Calendar, or Notion, on _My Persuna_ (OAuth; tokens are encrypted with `CONNECTIONS_KEY` and stay on the server). Then just ask: "what did Ada email me about?", "reply to Ada that 3pm works", "what's on Friday?", "put lunch with Sam on Friday at 1", "add a page called Weekly ideas to Notion". Persuna works in small steps (search, read, then act): reads happen straight away, a reply can be saved as a Gmail draft, and anything that sends, invites or creates shows a card with exactly what will happen, so nothing goes out without your OK. Whatever emails and pages say is treated as data, never as instructions. The audit log records connects, disconnects and each send or create by name only. Setup: a Google Cloud OAuth client (Gmail and Calendar APIs) and a Notion public integration, with redirect URIs `{APP_URL}/api/connections/google/callback` and `/notion/callback`.
- **Hand it work:** "Turn these notes into minutes" opens a small form: pick a published skill, paste the input or upload a file, and it drafts the result as a normal owner job. Approve, edit or send it back right there. The input and draft stay in `jobs` (purged after retention); the chat only records that a task ran.
- **Reminders and to-dos:** "Remind me at 4pm to send the minutes" or "in 20 minutes", or "todo: book the room". Times are the user's local time. Due reminders show in the chat, are read aloud if 🔊 is on, and appear as browser notifications once allowed. Manage them on the _My Persuna_ page.
- **Coaching:** "How is my minutes skill doing?" gives where it stands and the next step to a listing, e.g. its score against `LISTING_MIN_SCORE` with a rough number of examples to add. The _My Persuna_ page shows this for every skill. The estimate is a rule of thumb (`src/lib/persuna/coach.ts`) and says so.
- **End-of-day wrap-up:** after 5pm it offers once; or say "wrap up my day". Built from what actually happened (focus, tasks drafted and approved, notes, done and open to-dos), with no model call.
- **Public profile:** every persuna gets `/persunas/<handle>` with its listed skills, scores, trust level, how many people rented it in the last 30 days, and renters' ratings. Marketplace cards link to it. Never the owner's notes, memory or chats.
- **Watching, only with permission:** "Watch my screen" explains what happens, then asks you to share one window. It looks every 30 seconds, only when the window has changed (at most 40 looks a session), and writes the steps it sees into a note. Screenshots are never stored. When you stop, "Teach it" sends those steps to the focus skill. Without permission it just sits there. The browser's picker can share any app's window (Figma, a video editor), and **Persuna Desktop** (`desktop/`, see its README) puts Persuna over your whole screen, above every app, with clicks passing through. On the desktop, watching needs the operating system's permission once instead of sharing a window each time. Downloads for Mac (Apple silicon and Intel) and Windows are on the [Releases page](https://github.com/utibe-ettebong/Persuna/releases/latest).

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

- Submit an input: paste it, upload text or Word, **upload a PDF, scan or photo**, or record a voice note. PDFs go through Meta's Files API and images straight to Muse Spark; each page is transcribed word for word and marked "[file · page n]", and the upload is deleted from the provider once read. It is drafted with the _published_ version.
- **Every statement is checked against the input** (the verification pattern from Meta's agent workshop): the model lists each fact in the draft with the exact words of the input that support it, and code checks each quote really is there. Unsupported statements go back to the model by name for a rewrite, up to twice; whatever is still unsupported is flagged, so the job comes to you. The job page shows how many statements were checked and any that aren't backed by the input.
- **Self-check:** before you see it, the agent checks its draft against the input and the rules. It flags missing information, invented details, rule conflicts and unusual input, and separately flags numbers in the draft that never appear in the input. Flagged jobs always come to you.
- **Trust levels** (_Trust_ tab): level 0 reviews everything. Level 1 auto-approves unflagged jobs and needs `TRUST_L1_MIN_JOBS` (20) owner-reviewed jobs on the published version, with `TRUST_L1_MIN_CLEAN_PERCENT` (90%) approved unchanged or with minor edits and no complaints. Level 2 spot-checks 1 in `TRUST_SPOT_CHECK_EVERY` (5) and needs `TRUST_L2_MIN_JOBS` (50) jobs at level 1 with none rejected. You climb when you choose and can step down at any time. A new published version or a renter complaint resets to 0.
- Approve as is, edit and approve, or reject. Each approval records the edit size (none, minor up to 15% of words, or major), and the page shows the share approved unchanged or with minor edits.
- Download the approved result as .docx or .md.
- _Teach the skill from your edit_: proposes rule changes from a job edit. Only the rule changes and your reason are stored, never the client's text.
- Jobs are deleted after `JOB_RETENTION_DAYS` (30 by default).

**Rent it out** (skill → Listing, Marketplace, Earnings)

**Bring your agent's skills** (Skills → _Bring your agent's skills_, `/skills/import`)

- Other AI agents a person uses (Grokbot, Musebot, Dot…) can send Persuna what they have learned about how that person works. The person creates a key per agent (shown once; only its SHA-256 is stored; revocable) and the agent calls `POST /api/agents/skills` with `Authorization: Bearer psk_…` and a `persuna.skill-import/v1` body: `{ agent, skill: { name, task, input?, output? }, method: string | string[], examples: [{ input, output, test? }] }` (3–50 examples, size-limited, 10 imports an hour per key, 2 in flight per account). It answers `202` with an id; `GET /api/agents/skills/<id>` returns the status (`received → training → testing → verified | failed`) and a report of counts, score and problems, never the text. The same JSON can be uploaded as a file.
- After answering, Persuna does what it does when it's taught directly: names and identifiers are found and replaced (method only), a new skill is created with the method as its interview steps, examples are split (the agent's `test` flags, or about a quarter held back), rules are extracted and tested on the held-back examples. At `LISTING_MIN_SCORE` or more it's **verified** and the person gets a message from their Persuna with the score and a one-click _Publish and list_ (price plus their ownership declaration). The submission is held only until its redacted examples are saved, then cleared. Each stage is recorded, so an interrupted import resumes, and any failure lands as `failed` with a reason. Every step is audited.

**Projects** (`/projects`, public to browse; posting and proposing need an account)

For work bigger than one task. Persuna is involved at every stage, and every check it makes is posted to the project's timeline:

1. **Posting:** the poster writes a title, brief, budget (US$) and deadline. Persuna turns the brief into a scope, acceptance criteria and 1–5 milestones whose amounts add up exactly to the budget, and flags vague requirements and unfair terms (a budget that doesn't fit the scope, an impossible deadline, one-sided terms), partly by model and partly by fixed rules (`src/lib/projects/rules.ts`). The poster edits everything before opening it.
2. **Proposals:** sellers propose a price, days and a message (optionally pointing at one of their listings). Persuna writes the poster a **fit report** (the seller's Persuna Verified skills and scores, price against budget, strengths, risks, a recommendation). The seller sees their own report too. Accepting a proposal rescales the milestone amounts to the agreed price, to the cent.
3. **Escrow per milestone:** the poster funds each milestone through the payment provider (mock, or Paystack in USD, verified server-side exactly like rentals; references are `persuna-ms-…` and the webhook routes them).
4. **Delivery checks:** each delivery is checked against that milestone's criteria: met, not met or can't tell, each with a reason, plus a fairness note for each side. Both see it. The poster approves (escrow released to the seller minus `PLATFORM_FEE_PERCENT`) or asks for changes, up to `MAX_CHANGE_ROUNDS` (3) per milestone.
5. **Disputes:** either side can raise one; Persuna records a neutral assessment and the project is marked disputed. Held money stays in escrow; an admin (`ADMIN_EMAILS`) settles each held milestone (release or refund) or resumes the project. Everything is audited.
6. **Completion:** when every milestone is paid, Persuna writes a short wrap-up and each side rates the other.

Anyone can see an open project's title, scope, budget and milestones; signed-in people also see the brief; proposals, deliveries, checks and the timeline are only for the people on it. The poster can cancel until work is delivered (funded milestones are refunded). Briefs, deliveries, proposal messages and timeline text are material: they stay in the project tables and are blanked `JOB_RETENTION_DAYS` after the project ends, and they never go into a skill. Seller payouts from milestones appear on the Earnings page.

**Persuna for teams** (`/team`)

For companies: everyone has a Persuna that learns their role and the way the company works, and when the company hires, Persuna takes the new person through how the job is done there.

1. **Organisations, roles and people.** Anyone can start an organisation and becomes its first admin. Admins add roles (Designer, Account manager…) and invite people by email to a role. The invitation link (`/team/join/<token>`, shown once; only its SHA-256 is kept; 14 days) needs sign-in with the invited address. Pending invitations also show on the invitee's `/team` page. A person can be in several organisations; one always keeps an admin. People who leave stay listed as former holders of their role.
2. **Company know-how stays confidential.** A member attaches the skills that are part of their job to their role. An attached skill is confidential: a live listing is taken down at once, it can't be listed again (the listing gate says why: `src/lib/market/rules.ts`), it never appears on public profiles or in the marketplace (even by link), and its method is visible only to the organisation's admins and people in the same role. Admins also write a **handbook**: how the company works (values, tools, processes).
3. **Role playbooks.** For each role, Persuna writes a playbook from the rule sheets of every skill attached to it by current and former holders, plus the handbook: the workflows the role runs, step by step, the tools, the quality bar and common mistakes. Method only: never examples or job text. Each build is a new version; admins edit the draft and publish it to recruits, and can rebuild it as the team's skills improve.
4. **New-hire onboarding.** An admin starts onboarding for a member (or ticks _New hire_ on the invitation, and it starts when they join). Persuna turns the published playbook into modules (the company and handbook first, then one per workflow), each with short lessons, a hands-on practice task and a check. At `/team/onboarding/<id>` the recruit reads, asks Persuna questions (answered only from the playbook and handbook; it says when it doesn't know; questions aren't saved), hands in practice work and answers the check, which Persuna marks against a rubric with feedback (70 to pass), and marks each module done. Admins see everyone's progress. At the end, Persuna offers starter skills, one per workflow, so the recruit's own Persuna starts with the company's way of working; they stay attached to the role, and only an admin can release them.
5. **Persuna knows.** While someone is onboarding, their Persuna knows the role, the company and the next module, and helps with it in chat.

Rules are in `src/lib/teams/rules.ts` (invitations, permissions, confidentiality) and `src/lib/teams/onboarding.ts` (plans, marking, progress, starter skills). Every change is audited, with ids and small facts only; handbook text and recruits' answers never go in the log.

**The renter workspace** (Marketplace → an order)

- A renter uploads up to 5 files (text, Word, PDF, scans, photos) and/or pastes notes. Each file is read and labelled with its name, so the work and the statement check can tell them apart.
- When the result arrives they can **ask for changes** in plain words ("put the action items in a table", "fix the date in item 3"), up to 2 rounds (`MAX_REVISIONS`). Persuna revises the version they saw, keeping the rest, and checks every statement against the input and their request. The new version goes through the same review gate (the owner sees the request and the earlier version), and the payment stays held until the renter accepts.
- Earlier versions and the requests made against them stay on the order for both sides, and are deleted with the job after the retention period.

- **The marketplace is public.** Anyone can browse `/market` and open a listing; renting needs an account (signed-out visitors are sent to sign in and come back to the listing). Search, filter (output type, price range, minimum score, turnaround) and sort (best score, most rented, top rated, price, newest) live in the URL, so results can be shared. Listing pages carry Open Graph metadata. Owners choose **public** (in the marketplace and on their profile) or **unlisted** (link only, not indexed).
- **Persuna Verified:** each card and listing shows the published version's score on held-back examples, how many examples, and when it was last verified. It is re-checked on every publish and every re-test of the published version, and a live listing whose score drops below `LISTING_MIN_SCORE` is **paused automatically** (audited as `listing.paused`); the owner puts it live again once a qualifying version is published.
- Listing pages also show a **fair-deal guarantee** (escrow, review, revisions, refunds) and a **ratings summary** with recent reviews. Ratings are copied onto the payment record when a renter accepts, so they outlive the job's retention period.
- **Prices are in US dollars**, held as integer cents everywhere (`src/lib/money.ts`). Payments made in naira before the switch keep their naira amounts and are shown in naira on the Earnings page.
- A listing has a price, turnaround, sample output, owner type and an ownership declaration. It can only go live with a published version that scores at least `LISTING_MIN_SCORE` (80 by default) and with ownership declared.
- **Employer approval:** an employee listing names their employer and gets a private approval link (`/approvals/<token>`, open without the app password). The employer approves and sets their share of earnings, or declines. The listing can't go live until approved, and changing the employer starts the approval again.
- Owners can offer **guaranteed owner review** for an extra fee. Those jobs always come to the owner, whatever the trust level.
- Renters submit a task with their email. The listing shows the trust level ("owner-reviewed" or "auto-approved"). The owner reviews the draft like any other job, unless trust allows auto-approval. The renter sees only the approved result (rendered, plus .docx), then accepts and rates it, which releases the payment minus `PLATFORM_FEE_PERCENT` (20% by default) and any employer share. If the owner rejects the job, or the renter reports a problem, the renter is refunded and a complaint resets trust to 0.
- **Payments:** `PAYMENTS_PROVIDER=mock` (the default) records payments without moving money. `PAYMENTS_PROVIDER=paystack` with `PAYSTACK_SECRET_KEY` and `APP_URL` sends renters to Paystack checkout in USD (the Paystack account must have USD enabled). Payments are verified, including that the currency is USD and the amount is exactly the order's cents, with Paystack's API (from the return redirect and from the signed webhook at `/api/webhooks/paystack`) before any work starts, and refunds go back through Paystack. Payouts to owners and employers are recorded on the Earnings page and settled from the Paystack dashboard; automatic transfers are not built.
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

| Role       | Used for                                               | Intended model                      |
| ---------- | ------------------------------------------------------ | ----------------------------------- |
| `extract`  | Rule extraction; turning corrections into rule changes | Muse Spark (Meta Model API)         |
| `draft`    | Drafting outputs                                       | Muse Spark Open on Baseten          |
| `evaluate` | Scoring drafts against held-back examples              | Muse Spark Open on Modal or Baseten |

> Before you rely on these roles, check the provider docs: confirm the exact model IDs and that each endpoint accepts OpenAI-style `POST {base}/chat/completions` requests. If one doesn't, add an adapter in `src/lib/models/gateway.ts`. Nothing else needs to change.

## Layout

```
data/skills/meeting-minutes/     skill.json + pairs/train and pairs/test (*.input.md / *.output.md)
drizzle/                         generated SQL migrations (commit these)
scripts/skill.ts                 CLI for the training loop
scripts/migrate.mjs              applies migrations (Railway pre-deploy)
scripts/voice-latency.ts         voice latency probe: streamed turns + first-sound estimate (needs live keys)
livekit-trial/                  trial voice agent on LiveKit (own deps; needs a LiveKit Cloud project)
src/lib/skill/engine.ts          the loop itself, with no storage: extract, draft, score, correct
src/lib/skill/service.ts         skills, pairs, versions, test runs, corrections, publishing (Postgres)
src/lib/skill/prompts.ts         every prompt in one place
src/lib/skill/redact.ts          identifier scan for example pairs
src/lib/persuna/                 the assistant: brain (no storage), service, types
src/components/persuna/          the on-screen companion, setup, task runner, screen watcher, My Persuna page pieces
desktop/                         Persuna Desktop: Electron shell around /companion
src/lib/jobs/                    real jobs: draft, review, edit size, retention
src/lib/market/                  listings, rent, escrow, payouts, browse filters, Persuna Verified
src/lib/money.ts                 US cents: parsing and formatting
src/lib/agents/                  agent keys and skill imports (rules, service)
src/lib/projects/                projects: rules, Persuna's checks (no storage), service
src/lib/teams/                   teams: organisations, confidential skills, playbooks, onboarding
src/lib/docs/                    .docx export and .md/.txt/.docx upload reading
src/lib/models/gateway.ts        live model client: retries, timeouts, usage tracking
src/lib/models/mock.ts           offline mock models
src/app/actions/                 server actions (skills, jobs, market)
src/app/(site)/                  public pages: landing, employer approvals, persuna profiles
src/app/(open)/                  open to everyone, framed as studio when signed in: marketplace, projects board
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

### Voice latency probe

```bash
npm run voice:latency -- --turns 5 --budget-ms 8000
```

Times streamed voice turns against the live models (text turns plus one spoken turn, voiced by Persuna itself) and estimates end-of-speech to first-sound with p50/p95. Needs live `*_API_KEY`s and a configured speaker; exits 1 when a turn never streams or the p95 estimate passes the budget.

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

**Voice:** the browser converts every recording and upload to 16 kHz mono WAV. With a base URL on `api.meta.ai`, transcription uses Muse Voice Transcribe's native API (`/v1/asr/transcribe`); anything else uses OpenAI-style `/audio/transcriptions`. Override with `TRANSCRIBE_API=meta|openai`. Self-hosted Qwen3-ASR on Modal speaks the same shape (`modal-voice/README.md`). Recordings are capped at about 6 minutes.

**To verify before relying on it:** the webhook check uses Paystack's documented scheme (HMAC-SHA512 of the raw body with your secret key, in `x-paystack-signature`), but it couldn't be checked against Paystack's docs page during the build. Test it with a test-mode key.

## License

MIT
