import { test } from "node:test";
import assert from "node:assert/strict";
import { handleMcpMessage } from "../src/mcp.js";

const skills = [
  {
    slug: "board-minutes",
    name: "Board minutes",
    taskDescription: "Turn rough notes into board minutes",
    inputType: "meeting notes",
    outputType: "minutes",
  },
];

function fakeApi(overrides = {}) {
  return {
    listSkills: async () => skills,
    runSkill: async (slug, input) => ({
      jobId: "job-1",
      status: "approved",
      output: `ran ${slug} on ${input}`,
    }),
    getRun: async () => ({ jobId: "job-1", status: "approved", output: "done" }),
    importSkill: async () => ({ id: "imp-1", status: "received" }),
    ...overrides,
  };
}
const devEnv = { ALLOW_UNSAFE_EXECUTE: "1" };
const msg = (method, params, id = 1) => ({ jsonrpc: "2.0", id, method, params });

test("initialize answers with server info", async () => {
  const res = await handleMcpMessage(msg("initialize", {}), {}, fakeApi());
  assert.equal(res.result.serverInfo.name, "persuna");
  assert.equal(res.result.protocolVersion, "2025-03-26");
});

test("notifications get no response", async () => {
  const res = await handleMcpMessage(
    { jsonrpc: "2.0", method: "notifications/initialized" },
    {},
    fakeApi(),
  );
  assert.equal(res, null);
});

test("tools/list includes static tools and one tool per skill", async () => {
  const res = await handleMcpMessage(msg("tools/list"), {}, fakeApi());
  const names = res.result.tools.map((t) => t.name);
  for (const expected of [
    "list_skills",
    "run_skill",
    "get_run",
    "import_skill",
    "execute",
    "skill_board-minutes",
  ]) {
    assert.ok(names.includes(expected), `missing ${expected}`);
  }
});

test("tools/call runs a per-skill tool", async () => {
  const res = await handleMcpMessage(
    msg("tools/call", { name: "skill_board-minutes", arguments: { input: "rough notes" } }),
    {},
    fakeApi(),
  );
  assert.match(res.result.content[0].text, /ran board-minutes/);
});

test("tools/call rejects empty input", async () => {
  const res = await handleMcpMessage(
    msg("tools/call", { name: "run_skill", arguments: { skill: "board-minutes", input: " " } }),
    {},
    fakeApi(),
  );
  assert.equal(res.result.isError, true);
});

test("execute runs code against the typed persuna API", async () => {
  const res = await handleMcpMessage(
    msg("tools/call", {
      name: "execute",
      arguments: {
        code: "const s = await persuna.listSkills(); const r = await persuna.runSkill(s[0].slug, 'notes'); return r.output;",
      },
    }),
    devEnv,
    fakeApi(),
  );
  assert.match(res.result.content[0].text, /ran board-minutes on notes/);
});

test("execute is refused without a sandbox", async () => {
  const res = await handleMcpMessage(
    msg("tools/call", { name: "execute", arguments: { code: "return 1;" } }),
    {},
    fakeApi(),
  );
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /not enabled/);
});

test("unknown method is a JSON-RPC error", async () => {
  const res = await handleMcpMessage(msg("resources/list"), {}, fakeApi());
  assert.equal(res.error.code, -32601);
});

test("batches answer each request", async () => {
  const res = await handleMcpMessage([msg("ping", {}, 1), msg("ping", {}, 2)], {}, fakeApi());
  assert.equal(res.length, 2);
});
