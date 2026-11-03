import { MAX_BODY_BYTES, bearerToken } from "@/lib/agents/rules";
import { authenticateAgent } from "@/lib/agents/service";
import { createModelClient } from "@/lib/models";
import { pluginCorsHeaders } from "@/lib/plugins/cors";
import { applySkillForKey, type PluginEditOp } from "@/lib/plugins/service";

export const dynamic = "force-dynamic";
// Applying a skill runs a model call; give it room.
export const maxDuration = 300;

const MODES: PluginEditOp[] = ["replace_selection", "insert_after", "append"];

/**
 * Applies one of the key owner's published skills to document text:
 * POST { skill: "<slug>", text: "<selection or document>",
 * instruction?: "<extra direction>", mode?: "replace_selection" |
 * "insert_after" | "append", source?: "docs" | "word" | ... }.
 * Answers { edits: [{ op, text }] }; the plugin places the text and the user
 * can undo. Document content is never stored.
 */
export async function POST(request: Request) {
  const cors = pluginCorsHeaders(request.headers.get("origin"));
  const key = await authenticateAgent(bearerToken(request.headers.get("authorization")));
  if (!key) {
    return error(401, ["Send a valid agent key: Authorization: Bearer [REDACTED]…"], cors);
  }

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return error(413, [`Body over ${MAX_BODY_BYTES} bytes`], cors);
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
    return error(413, [`Body over ${MAX_BODY_BYTES} bytes`], cors);
  }

  let body: {
    skill?: unknown;
    text?: unknown;
    instruction?: unknown;
    mode?: unknown;
    source?: unknown;
  };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return error(400, ["Body must be JSON: { skill, text }"], cors);
  }
  const slug = typeof body.skill === "string" ? body.skill.trim() : "";
  const text = typeof body.text === "string" ? body.text : "";
  const instruction = typeof body.instruction === "string" ? body.instruction : undefined;
  const mode = body.mode === undefined ? "replace_selection" : body.mode;
  const source =
    typeof body.source === "string" && body.source.trim()
      ? body.source.trim().slice(0, 40)
      : undefined;
  if (!slug || !text.trim()) {
    return error(400, ["Send { skill: '<slug>', text: '<selection or document>' }"], cors);
  }
  if (typeof mode !== "string" || !MODES.includes(mode as PluginEditOp)) {
    return error(400, [`mode must be one of ${MODES.join(", ")}`], cors);
  }

  const client = createModelClient({ id: key.userId, isAdmin: false });
  const result = await applySkillForKey(client, key, slug, text, {
    instruction,
    mode: mode as PluginEditOp,
    source,
  });
  if (!result.ok) return error(result.status, result.errors, cors);
  return Response.json({ edits: result.edits }, { headers: cors });
}

export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: pluginCorsHeaders(request.headers.get("origin")),
  });
}

function error(status: number, errors: string[], cors: Record<string, string>) {
  return Response.json({ error: errors[0], errors }, { status, headers: cors });
}
