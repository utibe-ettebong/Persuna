# Rented jobs on the owner's Mac, then the cloud worker

Phase 5's remainder (plan §6): today a rented job is drafted by server models
and reviewed in the studio. Running it on the owner's Mac means the Mac does
work in the owner's apps — via the operate channel Phase 5 already built —
with the renter's brief as the job, in the open.

## What's already there

- Operate actions (click/type/key/open) with proposal → approval → audit, the
  stop word, and take-over (src/lib/operate, desktop/operate.js).
- MCP tools with the same approval shape.
- Delivery self-checks (src/lib/jobs/self-check.ts) and grounding.
- Job states, escrow, disputes, refunds.

## The missing pieces

1. **A runner protocol.** The desktop can't be reached from the server; the
   page relays. A run needs: claim (one runner owns a job attempt), step
   proposals through the operate approval card, progress heartbeats, and a
   settle (deliver / fail / take over). Heartbeats also feed the indicator.
2. **The indicator and the log.** While a job runs on the Mac, the island and
   menu bar say which job is running, and a per-job activity log (steps
   proposed, approved, run, taken over) is visible to the owner — and, after
   delivery, to the renter as the work receipt.
3. **Brief-to-steps.** A rented brief ("do my invoices") must become
   propose-one-step-at-a-time operate actions against the learned procedure
   (episodes + rules), not a blind script. The procedure is the plan; the
   runner proposes, the owner approves each step (or pre-approves a bounded
   run: N steps, named apps only).
4. **The cloud worker (later).** Same protocol, but the runner is an isolated
   machine per job instead of the owner's Mac: no owner approval mid-run,
   full step log as the receipt, renter data never touches the owner's disk.

## Decisions needed before building

- Approval granularity for runs: every step, or bounded pre-approval (which
  bounds: steps, apps, minutes)?
- What the renter sees live: steps as they run, or only the receipt?
- Billing: per-step model cost attribution already exists (usage log); does a
  Mac run bill the renter for model calls, the owner, or neither?
- Cloud worker isolation bar: cap the blast radius (no credentials, allow-
  listed apps) or full desktop?

## Done when

A rented minutes job runs end to end with no owner input beyond the run's
pre-approval and passes its checks — on the Mac first, then on a cloud
worker.
