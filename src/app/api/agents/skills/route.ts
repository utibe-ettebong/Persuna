import { after } from "next/server";
import { bearerToken, MAX_BODY_BYTES, SKILL_IMPORT_SCHEMA } from "@/lib/agents/rules";
import {
  authenticateAgent,
  listRunnableSkills,
  processImport,
  receiveImport,
} from "@/lib/agents/service";

export const dynamic = "force-dynamic";
// Training and testing run after the response; give them room.
export const maxDuration = 300;

/**
 * An outside agent sends a skill it has learned for its person.
 * `Authorization: Bearer psk_…` (a key the person created under Skills →
 * Import), body `persuna.skill-import/v1`. Answers 202 with the import id at
 * once; Persuna redacts, trains and tests it afterwards. Poll
 * GET /api/agents/skills/{id} for the result.
 */
export async function POST(request: Request) {
  const key = await authenticateAgent(bearerToken(request.headers.get("authorization")));
  if (!key) return error(401, ["Send a valid agent key: Authorization: Bearer psk_…"]);

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return error(413, [`Body over ${MAX_BODY_BYTES} bytes`]);
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
    return error(413, [`Body over ${MAX_BODY_BYTES} bytes`]);
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return error(400, [`Body must be JSON in the ${SKILL_IMPORT_SCHEMA} schema`]);
  }

  const result = await receiveImport({ userId: key.userId, key, body });
  if (!result.ok) {
    const headers: HeadersInit = result.retryAfterSeconds
      ? { "retry-after": String(result.retryAfterSeconds) }
      : {};
    return error(result.status, result.errors, headers);
  }
  const id = result.import.id;
  after(async () => {
    await processImport(id).catch((e) => console.error("Agent import failed:", e));
  });
  return Response.json(
    { id, status: result.import.status, statusUrl: `/api/agents/skills/${id}` },
    { status: 202, headers: { location: `/api/agents/skills/${id}` } },
  );
}

/** The key owner's published skills, runnable via POST /api/agents/run. */
export async function GET(request: Request) {
  const key = await authenticateAgent(bearerToken(request.headers.get("authorization")));
  if (!key) return error(401, ["Send a valid agent key: Authorization: Bearer [REDACTED]…"]);
  return Response.json({ skills: await listRunnableSkills(key) });
}

function error(status: number, errors: string[], headers: HeadersInit = {}) {
  return Response.json({ error: errors[0], errors }, { status, headers });
}
