# Persuna: the plan

_Updated 31 October 2026. This is the working plan for the product: what Persuna is, the rules it keeps, what it learns and how, and what gets built next. Change it when the decisions change._

## 1. What Persuna is

Persuna is a desktop companion that lives in the Mac's notch, hears you, talks back, and does work in your apps. Its difference from every other assistant is that it **learns how you do your work**, as skills, and can do that work for you and for others, on the marketplace, in your style.

Three things follow from that:

1. It must feel immediate. Feedback within milliseconds; speech within a couple of seconds, heading for under one.
2. It must learn without being told everything. Watching you work is the main way skills get complete.
3. Watching has to be something you switch on, see, and switch off. Never a background camera.

## 2. The rules Persuna keeps

These hold everywhere: desktop, web, marketplace, cloud worker.

- **No screen outside Work mode.** Persuna reads the screen (the list of what's on it, a screenshot, or text from it) only while Work mode is on, and shows that it's on the whole time. Talking to Persuna, typing to it, reminders, notices and the wrap-up never look at the screen. The old "Look at my screen when I talk" setting goes.
- **One explicit look is a mini Work mode.** Circling something on screen, or saying "look at my screen", turns Work mode on for that one question, with the indicator shown, and off again after. Nothing is kept from it.
- **Method, not material.** Skills, examples, corrections and observed traces hold how you work. Never the content you worked on: names, figures, dates, documents, messages. Job text stays in jobs and is purged after retention.
- **Nothing learned without your say-so.** Observations become proposals. You review a proposal before it changes a skill. A rule enters a skill only after you confirm it or a test shows it holds.
- **Keys stay on the server.** The app gets single-use tokens and short-lived addresses, never provider keys.
- **Everything someone would ask "who did that?" about is audited**, in the same transaction.
- **Company know-how stays with the company.** Skills that are part of a job are confidential to the organisation and can't be listed.

## 3. Modes

Persuna has four states. The island shows which one it's in, always.

| Mode                         | What Persuna can see                                                                                                      | How it starts                                                                                                     | How it ends                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Talk** (default)           | Nothing on screen. Your voice or typing only.                                                                             | Always on                                                                                                         | —                                                                                    |
| **Work**                     | The screen: the accessibility list of what's on it, text read from it, and a screenshot when needed. The indicator is on. | You say "work with me" or "watch my screen", or switch it on in the menu. Persuna explains once what it will see. | You switch it off, say "stop", or after a quiet period you set (default 30 minutes). |
| **Look** (one question)      | One read of the screen, or the part you circled, for this question. The indicator flashes.                                | You circle something, or ask about the screen while in Talk mode. Persuna asks "Shall I look?" the first time.    | After the answer.                                                                    |
| **Learn** (inside Work mode) | What Work mode sees, plus the sequence of your actions, as an episode tied to a skill.                                    | You say "learn how I do this" or Persuna offers when it recognises a task you've named.                           | You say "done", or the task's app pattern ends.                                      |

What is never captured, in any mode: keystrokes as text, clipboard contents, passwords and fields marked secure, personal apps you exclude, anything while the indicator is off.

What Work mode sends to the model: the list of elements (role and label), text read from the screen, the app and window names, and a screenshot only when the list is thin or the question is about how something looks. Screenshots are used for the answer and deleted. Nothing from Work mode is stored unless Learn mode is on and you later approve the proposal it produces.

## 4. Learning skills

### 4.1 What a skill is

Today a skill is a document transformation: input text to output text, with rules about structure, content, cuts, tone and naming, plus a template. That fits minutes, emails and reports. It misses how work actually happens: where it comes from, which tools you use, how you check it, where it goes.

A skill becomes a **procedure** with six layers. Capture is complete only when every layer has evidence.

| Layer                   | What it holds                                                                                                                                          | Where it comes from                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| 1. Trigger              | When the task starts: what arrives, how often                                                                                                          | Interview; app and window patterns over time                                                                |
| 2. Inputs               | What you open and read before you start, and in what form                                                                                              | App, window and file type, never content                                                                    |
| 3. Procedure            | Ordered steps with branches: app, action, control role, decision points                                                                                | Learn mode: accessibility events with timing; screenshots used for extraction, then deleted                 |
| 4. Tools and prompts    | Which tools, including AI chats and MCP servers; your prompt template, the constraints you repeat, what you correct the AI on, when you stop iterating | Learn mode in a browser; chat exports you choose to share; MCP call logs with argument shapes, never values |
| 5. Standards and checks | What every finished piece contains, what you always cut, never change, how you verify before "done"                                                    | Interview (today's questions); observed re-reads and comparisons                                            |
| 6. Output and handoff   | Format, where it goes, who receives it (by role), what happens after                                                                                   | App and window patterns; interview                                                                          |

The interview grows from today's seven writing questions to cover all six layers. The existing questions stay as layer 5.

### 4.2 What Learn mode records

An **episode** is one performance of one task. It's the process-mining minimum plus what AI extraction needs:

- Episode id, skill, start and end time.
- Events: time, app, window title, control role, action (click, type, paste, open, switch, submit), target role and label. **No typed text, no clipboard, no field values.**
- Screenshots at step changes, kept only until the extraction pass has run, then deleted.
- Your narration if you talk while doing it.

AI chats are a special case of layer 4. In a browser, the accessibility tree exposes the prompt box and the reply, so Persuna can record the **shape** of your prompting: how long, whether you pasted something (and its type), how many refinement turns, and what you asked the AI to change. Those corrections are rules in disguise. The content of the paste and of the reply is never kept. Desktop apps for ChatGPT and Claude are Electron and expose little; the plan assumes browser use for capture, and an optional chat export you choose to share.

### 4.3 From episodes to rules

A periodic learning pass turns episodes into proposals through the existing corrections flow:

1. Extract steps and rules from the episode (events plus screenshots plus narration), the way the screen walkthrough does today.
2. Attach evidence to every rule: which episodes, interview answers or corrections support it.
3. Seen once is a hypothesis; seen three times is a rule; contradicted means Persuna asks you.
4. Propose the change. You approve, edit or reject. Nothing enters the skill otherwise.

### 4.4 Completeness criteria

How we know nothing was left out:

1. **Fitness.** Replay the skill against every recorded episode. At least 90% of observed steps map to a skill step.
2. **Precision.** No step in the skill that was never observed, confirmed or taught.
3. **Generalization.** The skill holds on a held-out episode or pair, as the train/test split does today.
4. **Branch coverage.** Every decision point has an observed example per branch, or it's marked unobserved and Persuna asks about it. Exceptions rarely appear in recordings; they have to be asked for.
5. **Evidence per rule.** Every rule carries its evidence count and a confidence. Low confidence means ask, not assume.
6. **Verified before stored.** Confirmed by you, or a replay produced the expected result.

### 4.5 Skill rating

The rating becomes a composite shown on the skill, the profile and the listing:

| Part               | What it measures                                                | Source                    |
| ------------------ | --------------------------------------------------------------- | ------------------------- |
| Replication        | How close Persuna's output is to yours on held-out examples     | Today's 0–100 score, kept |
| Coverage           | Fitness and branch coverage from 4.4                            | Learning pass             |
| Confidence         | Share of rules with two or more independent sources             | Evidence counts           |
| Groundedness       | Every rule traceable to an observation, answer or correction    | Evidence links            |
| Freshness          | Recent episodes still fit the skill; your method hasn't drifted | Learning pass             |
| Reliability in use | Jobs delivered without correction                               | Trust levels, as today    |

The publish gate keeps its rule (a tested version that doesn't score lower) and adds a minimum coverage and confidence for listing. Persuna Verified on the marketplace shows the composite, not one number.

## 5. Being immediate

Where the voice path stands after this week, and what's next.

Done:

- Replies stream sentence by sentence; typed and voice share one path.
- Your voice is transcribed as you talk (ElevenLabs Scribe Realtime); no recording travels.
- A tick and the Thinking status within about 20 ms of releasing the key.
- Speech goes straight from the app to ElevenLabs over a connection opened ahead of time.
- The screenshot stays on the Mac unless the turn needs it.
- The least reasoning on the voice path; a backup model during Meta outages.
- The island picks up new builds by itself.

Measured, with the server on the Mac: first sound 2.0–3.7 s after key release, most of it the model's time to first token (1.3–3.0 s).

Next:

1. **Realtime trial on LiveKit** (`livekit-trial/`): Gemini Live first, a pipeline fallback. Target under 800 ms to first sound, with tools calling Persuna's server. Needs a LiveKit Cloud project. Decide from ten measured turns per engine.
2. **Start thinking early**: begin the turn from live words before the key is released, cancel if the words change.
3. **A faster model for the voice path**, or the realtime model as the voice brain, with Persuna's server as the tool backend.
4. **Hands-free end-of-turn** from the transcriber rather than one second of silence.

Targets: tick ≤ 50 ms, first sound ≤ 800 ms (p50) and ≤ 1.5 s (p95), no gaps between sentences, interruption within 200 ms.

## 6. Doing the work

Skills are for doing, not only writing. Persuna already connects Gmail, Calendar and Notion, proposes MCP calls you approve, and has a Work mode that guides, leads or follows.

- **Operate apps in Work mode.** Click, type and navigate on your behalf with your hand on the mouse to take over. Every action shown before it happens; a stop word always works.
- **Rented jobs on your Mac first**, as decided, with a visible job indicator and a log you can read. Then the **cloud worker**: an isolated machine per job, the default once it exists.
- **MCP as the tool layer.** Each connected server's tools are what Persuna can do; each call is proposed, approved, audited.
- **Every delivered job checked** against its input and the skill's rules, with the self-check and grounding that exist today.

## 7. Other improvements

Each is a requirement, with how we'd know it's met.

**Privacy and control**

- A privacy page in plain words: what each mode sees, what's kept, for how long, where it goes (ElevenLabs for voice, the model providers for text). Met when every data flow in the code is described there.
- Excluded apps: a list of apps Persuna never reads, even in Work mode (banking, personal messages). Met when an excluded app's window yields nothing to the model.
- Export and delete everything about me, including episodes and memory, in one place.
- The indicator: a visible change on the island and in the menu bar whenever the screen is being read, tested so it can't be off while a read happens.

**Models and providers**

- Provider slots in Admin → Models: pick a provider and model per role from the keys set in Railway, not only a model ID. Met when switching the voice between ElevenLabs and Qwen is a click.
- Voice choice for the Voice role, and the reasoning level for the listening path, in the same place.
- Outage handling as a rule: after one "model not found", skip that provider for two minutes; a status line in Admin shows which provider is being skipped.
- A cost view: per-user and per-day model, voice and transcription spend, against the daily allowance.

**Reliability**

- Turn timing on a page: the voice-turn logs the server already writes, charted by day: first token, first sentence, first sound.
- A browser test in CI with a spoken question on a fake microphone (the test written this week), so the voice path can't regress silently.
- Desktop launch test and update test in CI for every release (the update test is manual today).

**Desktop**

- Apple Developer ID: signing with it ends the "Open Anyway" step and lets macOS's own updater take over. Budget $99 a year.
- Windows parity for Work mode: a UI Automation reader exists (`desktop/native/win/eyes.ps1`), so the gap is testing it against the Mac reader on the same screens, and the Windows side of Learn mode's event stream.
- Permissions walkthrough that detects a stale grant and fixes it in one step.

**Teams and marketplace**

- Employer approval and confidentiality as they are; add a per-skill "visible to my team" setting.
- Imports from other agents' skill formats (SKILL.md and similar) into the six-layer model, with the import marked as unverified until tested.
- Disputes and refunds flow through the admin console with the audit trail attached.

## 8. Phases

Each phase ships on its own and is useful alone.

**Phase 1: screen only in Work mode** (days)

- Remove the "look at my screen when I talk" setting and the implicit look on every spoken turn.
- Add the Look mode for circled questions with the indicator.
- Work mode indicator on the island and in the menu bar; auto-off after a quiet period.
- Excluded apps list.
- Done when no code path reads the screen outside Work or Look, and a test proves it.

**Phase 2: Learn mode and episodes** (weeks)

- Accessibility event stream on the desktop (role, action, time; no values).
- Episodes tied to a skill; start and stop by voice.
- The learning pass producing proposals with evidence counts, through the corrections flow.
- The interview widened to six layers.
- Done when a skill learned from three episodes passes fitness ≥ 90% on a fourth.

**Phase 3: the composite rating** (weeks)

- Coverage, confidence, groundedness and freshness computed and shown.
- Listing requires minimum coverage and confidence.
- Done when every listed skill shows the composite and the gate blocks a skill with unobserved branches.

**Phase 4: immediate voice** (weeks, in parallel)

- LiveKit realtime trial measured; decision; integration of the winner as the voice brain with Persuna's server as tools.
- Done when p50 first sound ≤ 800 ms on the live site from Nigeria.

**Phase 5: doing the work** (months)

- Operating apps in Work mode with take-over; rented jobs on the owner's Mac; then the cloud worker.
- Done when a rented minutes job runs end to end with no owner input and passes its checks.

Throughout: the "other improvements" list, picked by what blocks the current phase.

## 9. Measures

- Time to tick, first sound and interruption, p50 and p95, per week.
- Episodes recorded per active user per week; proposals accepted versus rejected.
- Skills with full six-layer coverage, as a share of published skills.
- Jobs delivered without correction, by trust level.
- Daily model, voice and transcription cost per active user.
- Screen reads outside Work or Look mode: must be zero, from the audit log.

## 10. Open decisions

1. **Look mode:** does circling turn the screen on for one question without asking, or should Persuna ask the first time only? (Plan assumes ask once.)
2. **Quiet period for Work mode auto-off:** 30 minutes, or until the app changes?
3. **Chat exports:** offer an import of ChatGPT and Claude exports for layer 4, or rely on browser capture only?
4. **Realtime voice:** the trial needs a LiveKit Cloud project; who sets it up and when?
5. **Apple Developer ID:** buy it now, or after the next release?
