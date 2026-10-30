import { getUser } from "@/lib/auth/session";
import { directHearing } from "@/lib/models";
import { UsageLimitError } from "@/lib/models/usage";

/**
 * A short-lived address for the signed-in user's app to stream the microphone
 * to, so their words are known as they talk. 204 means this voice has none,
 * and the recording is sent when they finish. Counts against the daily model
 * allowance, like one transcription.
 */
export async function POST() {
  const user = await getUser();
  if (!user) return new Response("Sign in first", { status: 401 });
  try {
    const url = await directHearing(user);
    if (!url) return new Response(null, { status: 204 });
    return Response.json({ url }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof UsageLimitError) return new Response(error.message, { status: 429 });
    console.error(error);
    return new Response("The voice service failed", { status: 502 });
  }
}
