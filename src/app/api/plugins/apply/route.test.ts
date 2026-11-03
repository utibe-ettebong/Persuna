import { beforeEach, describe, expect, it, vi } from "vitest";
import { authenticateAgent } from "@/lib/agents/service";
import { createModelClient } from "@/lib/models";
import { applySkillForKey } from "@/lib/plugins/service";
import { OPTIONS, POST } from "./route";

process.env.DATABASE_URL ??= "postgres://localhost:5432/persuna_test";
process.env.PLUGIN_ORIGINS ??= "https://app-abc.canva-apps.com";

vi.mock("@/lib/agents/service", async (original) => ({
  ...((await original()) as Record<string, unknown>),
  authenticateAgent: vi.fn(),
}));
vi.mock("@/lib/plugins/service", () => ({ applySkillForKey: vi.fn() }));
vi.mock("@/lib/models", () => ({ createModelClient: vi.fn(() => ({})) }));

const KEY = { userId: "user-1", agentName: "docs-addon" };

const call = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request("https://app.example.com/api/plugins/apply", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer [REDACTED]",
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authenticateAgent).mockResolvedValue(KEY as never);
  vi.mocked(applySkillForKey).mockResolvedValue({
    ok: true,
    edits: [{ op: "replace_selection", text: "edited" }],
  });
});

describe("POST /api/plugins/apply", () => {
  it("applies the skill and returns the edits", async () => {
    const response = await call({ skill: "brief", text: "raw", source: "docs" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      edits: [{ op: "replace_selection", text: "edited" }],
    });
    expect(createModelClient).toHaveBeenCalledWith({ id: "user-1", isAdmin: false });
    expect(applySkillForKey).toHaveBeenCalledWith(
      {},
      KEY,
      "brief",
      "raw",
      expect.objectContaining({ mode: "replace_selection", source: "docs" }),
    );
  });

  it("reflects a listed origin", async () => {
    const response = await call(
      { skill: "brief", text: "raw" },
      { origin: "https://app-abc.canva-apps.com" },
    );
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://app-abc.canva-apps.com",
    );
  });

  it("sets no CORS headers for an unlisted origin", async () => {
    const response = await call(
      { skill: "brief", text: "raw" },
      { origin: "https://evil.example.com" },
    );
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("401s without a key", async () => {
    vi.mocked(authenticateAgent).mockResolvedValue(null);
    const response = await call({ skill: "brief", text: "raw" });
    expect(response.status).toBe(401);
  });

  it("400s a bad body or mode", async () => {
    expect((await call({ skill: "brief" })).status).toBe(400);
    expect((await call({ skill: "brief", text: "raw", mode: "rewrite" })).status).toBe(400);
    expect((await call("nope")).status).toBe(400);
  });

  it("passes service failures through", async () => {
    vi.mocked(applySkillForKey).mockResolvedValue({
      ok: false,
      status: 404,
      errors: ["No skill"],
    });
    const response = await call({ skill: "missing", text: "raw" });
    expect(response.status).toBe(404);
  });
});

describe("OPTIONS /api/plugins/apply", () => {
  it("answers preflights for allowed origins", async () => {
    const response = await OPTIONS(
      new Request("https://app.example.com/api/plugins/apply", {
        headers: { origin: "null" },
      }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("null");
  });
});
