/**
 * Operating apps in Work mode (plan §6): Persuna proposes one desktop action,
 * the app shows exactly what would happen, and the desktop runs it only when
 * the user approves. Same shape as MCP tool calls: a signed one-shot token
 * authorises each step, and every step is audited.
 *
 * The token lifecycle is pure so tests can pin it; the *AndAudit wrappers add
 * the audit row. One-shot and cancelled ids live in memory, like MCP's
 * confirmations: a redeploy forgets them, and outstanding tokens expire.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, type Actor } from "@/lib/audit";
import { connectionsKey } from "@/lib/connections/service";
import { readToken, signToken } from "@/lib/connections/crypto";
import { operateAction, previewOperate, type OperateAction } from "./actions";

/** How long a proposed action waits: its coordinates go stale as the screen changes. */
const CONFIRM_TTL_MS = 2 * 60_000;

export const operateOutcome = z.object({
  status: z.enum(["done", "took_over", "failed", "denied"]),
  detail: z.string().trim().max(300).nullish(),
});
export type OperateOutcome = z.infer<typeof operateOutcome>;

export interface OperateConfirm {
  id: string;
  token: string;
  preview: string;
  action: OperateAction;
}

export interface OperateExecution {
  id: string;
  execToken: string;
  action: OperateAction;
}

interface TokenOpts {
  secret?: string;
  now?: number;
}

function requireKey(secret?: string): string {
  if (secret) return secret;
  const key = connectionsKey();
  if (!key) throw new Error("Operating apps isn't set up on this deployment (CONNECTIONS_KEY).");
  return key;
}

interface Proposal {
  u: string;
  id: string;
  a: OperateAction;
  /** A proposal to approve, or an approved run to report on: never interchangeable. */
  p: "propose" | "exec";
}

const usedConfirmations = new Set<string>();
const usedExecutions = new Set<string>();
const cancelled = new Set<string>();

/** The brain proposed an action: Work mode only, fails closed on the shape. */
export function proposeOperate(
  userId: string,
  mode: string,
  action: unknown,
  opts: TokenOpts = {},
): OperateConfirm {
  if (mode !== "work") throw new Error("I only operate apps in Work mode.");
  const parsed = operateAction.parse(action);
  const now = opts.now ?? Date.now();
  const id = randomUUID();
  const token = signToken(
    { u: userId, id, a: parsed, p: "propose" } satisfies Proposal,
    requireKey(opts.secret),
    now + CONFIRM_TTL_MS,
  );
  return { id, token, preview: previewOperate(parsed), action: parsed };
}

/** The user approved: hand the desktop a one-shot execution token. */
export function confirmOperate(
  userId: string,
  token: string,
  opts: TokenOpts = {},
): OperateExecution {
  const secret = requireKey(opts.secret);
  const pending = readToken<Proposal>(token, secret, opts.now ?? Date.now());
  if (!pending || pending.u !== userId || pending.p !== "propose") {
    throw new Error("That request expired. Ask me again?");
  }
  if (cancelled.has(pending.id)) throw new Error("That action was cancelled.");
  if (usedConfirmations.has(pending.id)) throw new Error("That's already done.");
  usedConfirmations.add(pending.id);
  const execToken = signToken(
    { u: userId, id: pending.id, a: pending.a, p: "exec" } satisfies Proposal,
    secret,
    (opts.now ?? Date.now()) + CONFIRM_TTL_MS,
  );
  return { id: pending.id, execToken, action: pending.a };
}

/**
 * The desktop finished (or the user took over): record the outcome. The stop
 * word cancels first, so a late report after "stop" is refused.
 */
export function settleOperate(
  userId: string,
  execToken: string,
  outcome: OperateOutcome,
  opts: TokenOpts = {},
): { id: string; action: OperateAction; outcome: OperateOutcome } {
  const settled = operateOutcome.parse(outcome);
  const pending = readToken<Proposal>(execToken, requireKey(opts.secret), opts.now ?? Date.now());
  if (!pending || pending.u !== userId || pending.p !== "exec") {
    throw new Error("That request expired. Ask me again?");
  }
  if (cancelled.has(pending.id)) throw new Error("That action was cancelled.");
  if (usedExecutions.has(pending.id)) throw new Error("That's already reported.");
  usedExecutions.add(pending.id);
  return { id: pending.id, action: pending.a, outcome: settled };
}

/** The stop word (or the Take over button): nothing further runs for this action. */
export function cancelOperate(id: string): void {
  cancelled.add(id);
}

/** Cancel by proposal token: only the user it was proposed to can stop it. */
export function cancelOperateToken(userId: string, token: string, opts: TokenOpts = {}): string {
  const pending = readToken<Proposal>(token, requireKey(opts.secret), opts.now ?? Date.now());
  if (!pending || pending.u !== userId) throw new Error("That request expired. Ask me again?");
  cancelOperate(pending.id);
  return pending.id;
}

/** Approval with its audit row: who let Persuna touch the desktop, and what. */
export async function confirmOperateAndAudit(
  userId: string,
  token: string,
  actor: Actor,
): Promise<OperateExecution> {
  const confirmed = confirmOperate(userId, token);
  await audit({
    actor,
    action: "operate.approved",
    entityType: "operate_action",
    entityId: confirmed.id,
    // The kind and size, never the words: typed text can be job text.
    details: {
      kind: confirmed.action.kind,
      chars: confirmed.action.kind === "type" ? confirmed.action.text.length : null,
    },
  });
  return confirmed;
}

/** Completion with its audit row, including take-overs. */
export async function settleOperateAndAudit(
  userId: string,
  execToken: string,
  outcome: OperateOutcome,
  actor: Actor,
): Promise<{ id: string; action: OperateAction; outcome: OperateOutcome }> {
  const settled = settleOperate(userId, execToken, outcome);
  await audit({
    actor,
    action: settled.outcome.status === "took_over" ? "operate.took_over" : "operate.settled",
    entityType: "operate_action",
    entityId: settled.id,
    details: { kind: settled.action.kind, status: settled.outcome.status },
  });
  return settled;
}

/** Cancellation with its audit row. */
export async function cancelOperateAndAudit(id: string, actor: Actor): Promise<void> {
  cancelOperate(id);
  await audit({ actor, action: "operate.cancelled", entityType: "operate_action", entityId: id });
}

/** Cancellation by proposal token, with its audit row. */
export async function cancelOperateTokenAndAudit(
  userId: string,
  token: string,
  actor: Actor,
): Promise<string> {
  const id = cancelOperateToken(userId, token);
  await audit({ actor, action: "operate.cancelled", entityType: "operate_action", entityId: id });
  return id;
}
