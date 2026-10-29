/**
 * Code mode execution. The agent's snippet runs against a typed `persuna`
 * facade whose four methods are its ONLY capability: no fetch, no network,
 * no filesystem.
 *
 * Production: when the Worker has a `CODE_LOADER` binding (Cloudflare
 * Dynamic Worker Loader), the snippet runs in a separate throwaway Worker
 * minted per call with `globalOutbound: null` (hard no-network) and the
 * API delivered as a service binding. Local development: when
 * `ALLOW_UNSAFE_EXECUTE` is "1", an AsyncFunction fallback runs it in this
 * isolate — convenient for tests and wrangler dev, NOT a security boundary,
 * so it is off unless explicitly enabled.
 */
const MAX_CODE_CHARS = 20_000;
const DEV_TIMEOUT_MS = 10_000;

/** The typed surface handed to snippets. Mirrors the Persuna agent API. */
export function persunaFacade(api) {
  return Object.freeze({
    listSkills: () => api.listSkills(),
    runSkill: (slug, input) => api.runSkill(String(slug), String(input)),
    getRun: (jobId) => api.getRun(String(jobId)),
    importSkill: (document) => api.importSkill(document),
  });
}

function capturingConsole(logs) {
  const push =
    () =>
    (...parts) => {
      if (logs.length < 50) {
        logs.push(parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" "));
      }
    };
  return { log: push(), info: push(), warn: push(), error: push() };
}

function stringifyResult(value) {
  if (value === undefined) return undefined;
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

/** Dev/test fallback. NOT sandboxed — only behind ALLOW_UNSAFE_EXECUTE=1. */
async function runDev(code, api) {
  const logs = [];
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const fn = new AsyncFunction(
    "persuna",
    "console",
    `"use strict"; return (async () => { ${code} })();`,
  );
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Code ran too long")), DEV_TIMEOUT_MS);
    timer.unref?.();
  });
  try {
    const value = await Promise.race([fn(persunaFacade(api), capturingConsole(logs)), timeout]);
    return { ok: true, result: stringifyResult(value), logs };
  } finally {
    clearTimeout(timer);
  }
}

const LOADER_MODULE = (code) => `
export default {
  async fetch(request, env) {
    const api = env.PERSUNA_API;
    const persuna = {
      listSkills: (...a) => api.listSkills(...a),
      runSkill: (...a) => api.runSkill(...a),
      getRun: (...a) => api.getRun(...a),
      importSkill: (...a) => api.importSkill(...a),
    };
    const logs = [];
    const cons = { log: (...p) => logs.push(p.join(" ")), info: (...p) => logs.push(p.join(" ")), warn: (...p) => logs.push(p.join(" ")), error: (...p) => logs.push(p.join(" ")) };
    try {
      const fn = new Function("persuna", "console", '"use strict"; return (async () => {' + ${JSON.stringify(code)} + '})();');
      const value = await fn(persuna, cons);
      return Response.json({ ok: true, result: typeof value === "string" ? value : JSON.stringify(value ?? null), logs });
    } catch (e) {
      return Response.json({ ok: false, error: String(e && e.message || e), logs });
    }
  },
};`;

/** Production path: a fresh isolate per call, no outbound network. */
async function runInLoader(code, env, apiBinding) {
  const stub = env.CODE_LOADER.load({
    compatibilityDate: "2025-09-01",
    mainModule: "main.js",
    modules: { "main.js": LOADER_MODULE(code) },
    env: { PERSUNA_API: apiBinding },
    globalOutbound: null, // the snippet (and its Function) can reach nothing on the network
  });
  const entry = stub.getEntrypoint();
  const res = await entry.fetch("http://sandbox/");
  const body = await res.json();
  return body.ok
    ? { ok: true, result: body.result === "null" ? undefined : body.result, logs: body.logs ?? [] }
    : { ok: false, error: body.error ?? "Sandbox failed", logs: body.logs ?? [] };
}

/**
 * Runs one snippet. Needs `env.apiBinding` (the Worker's PersunaApi
 * entrypoint) for the loader path; the dev fallback needs only `api`.
 */
export async function runCode(code, env, api) {
  if (code.length > MAX_CODE_CHARS) {
    return { ok: false, error: `Code over ${MAX_CODE_CHARS} characters`, logs: [] };
  }
  if (env?.CODE_LOADER && env?.apiBinding) {
    try {
      return await runInLoader(code, env, env.apiBinding);
    } catch (e) {
      return { ok: false, error: `Sandbox unavailable: ${e?.message ?? e}`, logs: [] };
    }
  }
  if (env?.ALLOW_UNSAFE_EXECUTE === "1") return runDev(code, api);
  return {
    ok: false,
    error:
      "Code execution is not enabled on this deployment (no sandbox binding). Use the individual tools instead.",
    logs: [],
  };
}
