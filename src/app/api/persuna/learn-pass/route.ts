import { timingSafeEqual } from "node:crypto";
import { setting } from "@/env";
import { createModelClient } from "@/lib/models";
import { learnPass } from "@/lib/skill/learn";

/**
 * The periodic learning pass, for a scheduler (Railway cron) to call: every
 * stopped episode that hasn't been learned from yet goes through extraction.
 * Called with the shared LEARN_PASS_SECRET, never with a user session.
 */
export async function POST(request: Request) {
  const secret = setting("LEARN_PASS_SECRET");
  const expected = secret ? Buffer.from(`Bearer ${secret}`) : null;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  if (!expected || expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return Response.json({ ok: false, error: "Not allowed" }, { status: 401 });
  }
  const { extracted, failed } = await learnPass(createModelClient());
  console.log(
    JSON.stringify({ scope: "learn-pass", extracted: extracted.length, failed: failed.length }),
  );
  return Response.json({ ok: true, extracted, failed });
}
