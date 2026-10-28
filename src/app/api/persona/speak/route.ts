import { z } from "zod";
import { speechConfig } from "@/env";
import { getUser } from "@/lib/auth/session";
import { createSpeaker } from "@/lib/models";
import { UsageLimitError } from "@/lib/models/usage";
import { speakingStyle } from "@/lib/persona/service";

const body = z.object({ text: z.string().trim().min(1).max(4000) });

/**
 * Speaks a whole reply in Persona's cloud voice, streamed as it's made. 204 means no voice is configured and
 * the browser should speak instead. Signed-in users only; counts against the
 * daily model allowance.
 */
export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return new Response("Sign in first", { status: 401 });
  const speaker = createSpeaker(user);
  if (!speaker) return new Response(null, { status: 204 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response("Nothing to say", { status: 400 });
  try {
    // Said in the style the user likes (brisk, formal, playful…), where the voice takes one.
    const style = speechConfig()?.api === "elevenlabs" ? undefined : await speakingStyle(user.id);
    const { audio, type } = await speaker.synthesize(parsed.data.text, style);
    return new Response(audio, {
      headers: { "content-type": type, "cache-control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof UsageLimitError) return new Response(error.message, { status: 429 });
    console.error(error);
    return new Response("The voice service failed", { status: 502 });
  }
}
