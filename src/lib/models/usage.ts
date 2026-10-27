import { and, count, eq, gte } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { env } from "@/env";
import type { ModelClient } from "./gateway";
import type { Transcriber } from "./transcribe";

const { modelUsage } = schema;

export interface Caller {
  id: string;
  isAdmin: boolean;
}

export class UsageLimitError extends Error {
  override name = "UsageLimitError";
}

/** Throws once the caller has used their daily allowance of live model calls. */
export async function checkAllowance(caller: Caller, limit = env().DAILY_MODEL_CALLS_PER_USER) {
  if (caller.isAdmin) return;
  const since = new Date(Date.now() - 86_400_000);
  const [{ used }] = await db()
    .select({ used: count() })
    .from(modelUsage)
    .where(and(eq(modelUsage.userId, caller.id), gte(modelUsage.at, since)));
  if (used >= limit) {
    throw new UsageLimitError(
      `You've reached today's limit of ${limit} AI calls. It resets on a rolling 24-hour basis.`,
    );
  }
}

async function record(caller: Caller, role: string) {
  await db().insert(modelUsage).values({ userId: caller.id, role });
}

/** Counts each live call against the caller's daily allowance. */
export function meteredClient(client: ModelClient, caller: Caller): ModelClient {
  return {
    async complete(role, messages, options) {
      await checkAllowance(caller);
      const result = await client.complete(role, messages, options);
      await record(caller, role);
      return result;
    },
  };
}

export function meteredTranscriber(transcriber: Transcriber, caller: Caller): Transcriber {
  return {
    async transcribe(audio, filename) {
      await checkAllowance(caller);
      const result = await transcriber.transcribe(audio, filename);
      await record(caller, "transcribe");
      return result;
    },
  };
}
