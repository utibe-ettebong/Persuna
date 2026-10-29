import { z } from "zod";
import { getUser } from "@/lib/auth/session";
import { startAgentSession } from "@/lib/persuna/voice-agent";

const query = z.object({ offset: z.coerce.number().int().min(-900).max(900) });

/**
 * Starts a voice session with ElevenLabs Agents for the signed-in user. 204
 * means the agent isn't set up, and the page listens the other way.
 */
export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return new Response("Sign in first", { status: 401 });
  const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return new Response("Bad offset", { status: 400 });
  try {
    const session = await startAgentSession(user.id, parsed.data.offset);
    if (!session) return new Response(null, { status: 204 });
    return Response.json(session, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error(error);
    return new Response("The voice service failed", { status: 502 });
  }
}
