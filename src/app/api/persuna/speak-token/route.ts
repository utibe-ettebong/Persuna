import { getUser } from "@/lib/auth/session";
import { directSpeech } from "@/lib/models";
import { UsageLimitError } from "@/lib/models/usage";

/**
 * A short-lived address for the signed-in user's app to speak from directly.
 * 204 means this voice has none, and the app uses /api/persuna/speak. Counts
 * against the daily model allowance, like one spoken line.
 */
export async function POST() {
  const user = await getUser();
  if (!user) return new Response("Sign in first", { status: 401 });
  try {
    const url = await directSpeech(user);
    if (!url) return new Response(null, { status: 204 });
    return Response.json({ url }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof UsageLimitError) return new Response(error.message, { status: 429 });
    console.error(error);
    return new Response("The voice service failed", { status: 502 });
  }
}
