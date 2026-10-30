import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { setting } from "@/env";
import { userIdByEmail } from "@/lib/auth/users";
import { addReminder, rememberFact } from "@/lib/persuna/service";

const call = z.object({
  /** The tester's Persuna sign-in email; the trial acts as this user. */
  userEmail: z.string().trim().min(3).max(254),
  tool: z.enum(["rememberFact", "setReminder"]),
  args: z.object({}).passthrough(),
});
const rememberArgs = z.object({ fact: z.string().trim().min(1).max(500) });
const remindArgs = z.object({
  text: z.string().trim().min(1).max(500),
  /** Local ISO time ("2026-10-30T15:30"), or null for a plain to-do. */
  at: z.string().trim().max(32).nullish(),
});

/**
 * Tools for the LiveKit trial agent (see livekit-trial/): the agent's brain
 * is Gemini Live, but facts and reminders land in Persuna itself. Called with
 * the shared LIVEKIT_TOOL_SECRET, never with a user session. 401 when the
 * secret is missing or wrong — the endpoint is inert without it.
 */
export async function POST(request: Request) {
  const secret = setting("LIVEKIT_TOOL_SECRET");
  const expected = secret ? Buffer.from(`Bearer ${secret}`) : null;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  if (!expected || expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return Response.json({ ok: false, error: "Not allowed" }, { status: 401 });
  }
  const parsed = call.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: "Bad tool call" }, { status: 400 });
  try {
    const userId = await userIdByEmail(parsed.data.userEmail);
    if (parsed.data.tool === "rememberFact") {
      const args = rememberArgs.safeParse(parsed.data.args);
      if (!args.success)
        return Response.json(
          { ok: false, error: "A fact needs 1–500 characters" },
          { status: 400 },
        );
      await rememberFact(userId, args.data.fact);
    } else {
      const args = remindArgs.safeParse(parsed.data.args);
      if (!args.success)
        return Response.json(
          { ok: false, error: "A reminder needs text and an optional time" },
          { status: 400 },
        );
      const due = args.data.at ? new Date(args.data.at) : null;
      if (due && Number.isNaN(due.getTime()))
        return Response.json({ ok: false, error: "That time didn't parse" }, { status: 400 });
      await addReminder(userId, { text: args.data.text, due });
    }
    return Response.json({ ok: true });
  } catch (error) {
    console.error(error);
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Something went wrong." },
      { status: 500 },
    );
  }
}
