import { bearerToken, MAX_BODY_BYTES } from "@/lib/agents/rules";
import { authenticateAgent, runSkillForKey } from "@/lib/agents/service";
import { createModelClient } from "@/lib/models";

export const dynamic = "force-dynamic";
// Drafting runs a model call; give it room.
export const maxDuration = 300;

/**
 * Runs one of the key owner's published skills: POST { skill: "<slug>",
 * input: "<the raw material>" }. Answers when the draft is ready; the
 * output is included only when the owner's trust level approved the run,
 * otherwise poll GET /api/agents/runs/{jobId} until it leaves review.
 */
export async function POST(request: Request) {
  const key = await authenticateAgent(bearerToken(request.headers.get("authorization")));
  if (!key) return error(401, ["Send a valid agent key: Authorization: Bearer [REDACTED]…"]);

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return error(413, [`Body over ${MAX_BODY_BYTES} bytes`]);
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES)
    return error(413, [`Body over ${MAX_BODY_BYTES} bytes`]);

  let body: { skill?: unknown; input?: unknown };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return error(400, ["Body must be JSON: { skill, input }"]);
  }
  const slug = typeof body.skill === "string" ? body.skill.trim() : "";
  const input = typeof body.input === "string" ? body.input : "";
  if (!slug || !input.trim()) return error(400, ["Send { skill: '<slug>', input: '<text>' }"]);

  const client = createModelClient({ id: key.userId, isAdmin: false });
  const result = await runSkillForKey(client, key, slug, input);
  if (!result.ok) return error(result.status, result.errors);
  return Response.json(
    {
      jobId: result.jobId,
      status: result.status,
      output: result.output,
      statusUrl: `/api/agents/runs/${result.jobId}`,
    },
    { status: 201 },
  );
}

function error(status: number, errors: string[]) {
  return Response.json({ error: errors[0], errors }, { status });
}
