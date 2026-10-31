import { getUser } from "@/lib/auth/session";
import { reportFirstAudio } from "@/lib/persuna/voice-metrics";

/**
 * The client's first-sound report: how long from the turn starting to
 * Persuna's first audible word. Fire-and-forget from playback — a stray,
 * replayed or late report is ignored with a 204, never an error, so a turn
 * never fails because its timing didn't land. Signed-in users only.
 */
export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return new Response("Sign in first", { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response("Bad report", { status: 400 });
  }
  const { turn, ms } = (body ?? {}) as { turn?: unknown; ms?: unknown };
  if (typeof turn !== "string" || turn.length === 0 || turn.length > 64) {
    return new Response("Bad report", { status: 400 });
  }
  if (typeof ms !== "number" || !Number.isFinite(ms)) {
    return new Response("Bad report", { status: 400 });
  }
  const joined = await reportFirstAudio(user.id, turn, ms);
  return new Response(null, { status: joined ? 200 : 204 });
}
