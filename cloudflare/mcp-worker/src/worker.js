/**
 * Persuna as an MCP server, on Cloudflare. Speaks MCP over streamable HTTP
 * at POST /mcp; the caller's Persuna agent key (Authorization: Bearer
 * KEY…) is forwarded to the Persuna agent API, which stays the single
 * source of truth for keys, trust and jobs.
 *
 * Two worker entrypoints are exported: the default fetch handler, and
 * `PersunaApi` — the typed API delivered into code-mode sandboxes as a
 * service binding (see code-mode.js). The env the class closes over is
 * per-request: Workers instantiates entrypoints per request context, and
 * the API key is read from the original request, stored below keyed by the
 * binding stub — so the sandbox never sees the raw key.
 */
import { WorkerEntrypoint } from "cloudflare:workers";
import { handleMcpMessage } from "./mcp.js";

function apiBase(env) {
  return (env.PERSUNA_API_URL ?? "https://persuna-production.up.railway.app").replace(/\/$/, "");
}

function persunaApi(env, key) {
  const base = apiBase(env);
  async function call(path, init = {}) {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `Persuna API ${res.status}`);
    return body;
  }
  return {
    listSkills: async () => (await call("/api/agents/skills")).skills ?? [],
    runSkill: (slug, input) =>
      call("/api/agents/run", { method: "POST", body: JSON.stringify({ skill: slug, input }) }),
    getRun: async (jobId) => {
      const res = await fetch(`${base}/api/agents/runs/${encodeURIComponent(jobId)}`, {
        headers: { authorization: `Bearer ${key}` },
      });
      if (res.status === 404) return null;
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Persuna API ${res.status}`);
      return body;
    },
    importSkill: (document) =>
      call("/api/agents/skills", { method: "POST", body: JSON.stringify(document) }),
  };
}

/** Sandbox-facing API: methods take no key — it was bound at mint time. */
export class PersunaApi extends WorkerEntrypoint {
  async listSkills() {
    return persunaApi(this.env, this.ctx.props.key).listSkills();
  }
  async runSkill(slug, input) {
    return persunaApi(this.env, this.ctx.props.key).runSkill(slug, input);
  }
  async getRun(jobId) {
    return persunaApi(this.env, this.ctx.props.key).getRun(jobId);
  }
  async importSkill(document) {
    return persunaApi(this.env, this.ctx.props.key).importSkill(document);
  }
}

function rpcError(id, code, message, status = 200) {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } }, { status });
}

const worker = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return Response.json({
        name: "persuna-mcp",
        transport: "streamable-http",
        endpoint: "/mcp",
        auth: "Authorization: Bearer KEY (a Persuna agent key)",
      });
    }
    if (url.pathname !== "/mcp") return new Response("Not found", { status: 404 });
    if (request.method !== "POST") return new Response("POST only", { status: 405 });

    const auth = request.headers.get("authorization") ?? "";
    const key = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
    let message;
    try {
      message = await request.json();
    } catch {
      return rpcError(null, -32700, "Body must be JSON-RPC", 400);
    }
    const id = Array.isArray(message) ? (message[0]?.id ?? null) : (message?.id ?? null);
    if (!key) {
      return rpcError(id, -32001, "Send your Persuna agent key: Authorization: Bearer KEY");
    }

    const api = persunaApi(env, key);
    // The code-mode sandbox gets the API as a binding whose props carry the
    // key, so sandboxed code never touches the raw credential.
    const mcpEnv = env.CODE_LOADER
      ? { ...env, apiBinding: ctx?.exports?.PersunaApi?.({ props: { key } }) }
      : env;

    const response = await handleMcpMessage(message, mcpEnv, api);
    if (response === null) return new Response(null, { status: 202 });
    return Response.json(response);
  },
};

export default worker;
