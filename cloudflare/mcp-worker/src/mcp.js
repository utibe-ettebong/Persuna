/**
 * Persuna MCP core: the JSON-RPC protocol spoken with Claude, ChatGPT,
 * Cursor and other MCP hosts. Pure and transport-free — the Worker wraps
 * this with HTTP, tests drive it directly. `api` is the typed Persuna
 * surface (listSkills / runSkill / getRun / importSkill), already
 * authenticated with the caller's agent key.
 *
 * Following Cloudflare's code mode: alongside the fine-grained tools, an
 * `execute` tool lets the agent write one TypeScript-flavoured snippet
 * against the typed `persuna` API instead of chaining tool calls, so
 * intermediate results never pass through the model.
 */
import { runCode } from "./code-mode.js";

export const PROTOCOL_VERSION = "2025-03-26";
const MAX_INPUT_CHARS = 200_000;

const STATIC_TOOLS = [
  {
    name: "list_skills",
    description:
      "List the Persuna skills this agent key can run: skills the owner has trained and published.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "run_skill",
    description:
      "Run one published Persuna skill on raw input. Returns the finished output when the owner's trust level approves the run, otherwise a jobId in awaiting_review to poll with get_run.",
    inputSchema: {
      type: "object",
      properties: {
        skill: { type: "string", description: "The skill slug, from list_skills." },
        input: { type: "string", description: "The raw material to work on." },
      },
      required: ["skill", "input"],
      additionalProperties: false,
    },
  },
  {
    name: "get_run",
    description:
      "Poll a skill run by jobId. The output appears once the owner-side trust check approves it.",
    inputSchema: {
      type: "object",
      properties: { jobId: { type: "string" } },
      required: ["jobId"],
      additionalProperties: false,
    },
  },
  {
    name: "import_skill",
    description:
      "Send a skill this agent has learned (persuna.skill-import/v1 document) to be redacted, trained and tested as one of the owner's Persuna skills.",
    inputSchema: {
      type: "object",
      properties: { document: { type: "object", description: "The skill-import document." } },
      required: ["document"],
      additionalProperties: false,
    },
  },
  {
    name: "execute",
    description:
      "Code mode: write ONE async TypeScript snippet against the typed `persuna` API instead of chaining tool calls: persuna.listSkills(), persuna.runSkill(slug, input), persuna.getRun(jobId), persuna.importSkill(document). Top-level await and `return` are supported. There is no network, filesystem or fetch: the `persuna` API is the only capability. Prefer this when a task needs several skills or post-processing.",
    inputSchema: {
      type: "object",
      properties: { code: { type: "string", description: "The snippet to run." } },
      required: ["code"],
      additionalProperties: false,
    },
  },
];

function skillTool(skill) {
  return {
    name: `skill_${skill.slug}`,
    description: `${skill.name} — ${skill.taskDescription} (Trained Persuna skill; give it ${skill.inputType}, get ${skill.outputType}.)`,
    inputSchema: {
      type: "object",
      properties: { input: { type: "string", description: `The ${skill.inputType}.` } },
      required: ["input"],
      additionalProperties: false,
    },
  };
}

function ok(id, result) {
  return { jsonrpc: "2.0", id, result };
}
function fail(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
function toolText(text, isError = false) {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}
function jsonText(value) {
  return toolText(JSON.stringify(value, null, 2));
}

async function callTool(name, args, env, api) {
  if (name === "execute") {
    const code = typeof args?.code === "string" ? args.code : "";
    if (!code.trim()) return toolText("Send { code } with a snippet to run.", true);
    const ran = await runCode(code, env, api);
    if (!ran.ok) return toolText(`Code failed: ${ran.error}`, true);
    const logs = ran.logs.length ? `\n\nLogs:\n${ran.logs.join("\n")}` : "";
    return toolText(`${ran.result ?? "(no return value)"}${logs}`);
  }
  if (name === "list_skills") return jsonText({ skills: await api.listSkills() });
  if (name === "run_skill" || name.startsWith("skill_")) {
    const slug = name === "run_skill" ? String(args?.skill ?? "") : name.slice("skill_".length);
    const input = typeof args?.input === "string" ? args.input : "";
    if (!slug || !input.trim()) return toolText("Send a skill slug and non-empty input.", true);
    if (input.length > MAX_INPUT_CHARS) return toolText("Input is too long.", true);
    return jsonText(await api.runSkill(slug, input));
  }
  if (name === "get_run") {
    const jobId = String(args?.jobId ?? "");
    if (!jobId) return toolText("Send { jobId }.", true);
    const run = await api.getRun(jobId);
    return run ? jsonText(run) : toolText("No such run for this key.", true);
  }
  if (name === "import_skill") {
    if (!args?.document || typeof args.document !== "object") {
      return toolText("Send { document } with the skill-import document.", true);
    }
    return jsonText(await api.importSkill(args.document));
  }
  return toolText(`Unknown tool: ${name}`, true);
}

/** Handles one JSON-RPC message. Returns the response, or null for notifications. */
export async function handleMcpMessage(message, env, api) {
  if (Array.isArray(message)) {
    const out = [];
    for (const m of message) {
      const r = await handleMcpMessage(m, env, api);
      if (r) out.push(r);
    }
    return out.length ? out : null;
  }
  const { id, method, params } = message ?? {};
  if (id === undefined || id === null) return null; // notification: nothing to answer
  try {
    switch (method) {
      case "initialize":
        return ok(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "persuna", version: "1.0.0" },
        });
      case "ping":
        return ok(id, {});
      case "tools/list": {
        const skills = await api.listSkills().catch(() => []);
        return ok(id, { tools: [...STATIC_TOOLS, ...skills.map(skillTool)] });
      }
      case "tools/call": {
        const name = String(params?.name ?? "");
        if (!name) return fail(id, -32602, "tools/call needs a tool name");
        return ok(id, await callTool(name, params?.arguments ?? {}, env, api));
      }
      default:
        return fail(id, -32601, `Unknown method: ${method}`);
    }
  } catch (e) {
    return fail(id, -32000, e instanceof Error ? e.message : "Persuna could not answer");
  }
}
