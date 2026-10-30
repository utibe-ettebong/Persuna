import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userIdByEmail } from "@/lib/auth/users";
import { addReminder, rememberFact } from "@/lib/persuna/service";
import { POST } from "./route";

vi.mock("@/lib/auth/users", () => ({ userIdByEmail: vi.fn() }));
vi.mock("@/lib/persuna/service", () => ({ addReminder: vi.fn(), rememberFact: vi.fn() }));

const SECRET = "a-long-test-secret-for-livekit-trial";

beforeEach(() => {
  process.env.LIVEKIT_TOOL_SECRET = SECRET;
  vi.mocked(userIdByEmail).mockResolvedValue("user-1");
});
afterEach(() => {
  delete process.env.LIVEKIT_TOOL_SECRET;
  vi.restoreAllMocks();
});

const call = (body: unknown, auth: string | null = `Bearer ${SECRET}`) =>
  POST(
    new Request("http://test/api/persuna/livekit-tool", {
      method: "POST",
      headers: auth ? { authorization: auth } : {},
      body: JSON.stringify(body),
    }),
  );

describe("POST /api/persuna/livekit-tool", () => {
  it("refuses calls without the shared secret", async () => {
    const wrong = await call({ tool: "rememberFact" }, "Bearer wrong");
    expect(wrong.status).toBe(401);
    delete process.env.LIVEKIT_TOOL_SECRET;
    const unconfigured = await call({ tool: "rememberFact" });
    expect(unconfigured.status).toBe(401);
    expect(rememberFact).not.toHaveBeenCalled();
  });

  it("remembers a fact for the trial user", async () => {
    const res = await call({
      userEmail: "tester@example.com",
      tool: "rememberFact",
      args: { fact: "likes 24h times" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(userIdByEmail).toHaveBeenCalledWith("tester@example.com");
    expect(rememberFact).toHaveBeenCalledWith("user-1", "likes 24h times");
  });

  it("sets reminders with a parsed time, or as to-dos", async () => {
    const timed = await call({
      userEmail: "tester@example.com",
      tool: "setReminder",
      args: { text: "stretch", at: "2026-10-30T15:30" },
    });
    expect(timed.status).toBe(200);
    expect(addReminder).toHaveBeenCalledWith("user-1", {
      text: "stretch",
      due: new Date("2026-10-30T15:30"),
    });

    const todo = await call({
      userEmail: "tester@example.com",
      tool: "setReminder",
      args: { text: "stretch", at: null },
    });
    expect(todo.status).toBe(200);
    expect(addReminder).toHaveBeenCalledWith("user-1", { text: "stretch", due: null });
  });

  it("rejects bad calls without acting", async () => {
    expect((await call({ tool: "rememberFact" })).status).toBe(400);
    expect(
      (await call({ userEmail: "t@e.com", tool: "rememberFact", args: { fact: "" } })).status,
    ).toBe(400);
    expect(
      (await call({ userEmail: "t@e.com", tool: "setReminder", args: { text: "x", at: "never" } }))
        .status,
    ).toBe(400);
    expect(rememberFact).not.toHaveBeenCalled();
    expect(addReminder).not.toHaveBeenCalled();
  });

  it("reports service failures as 500", async () => {
    vi.mocked(userIdByEmail).mockRejectedValueOnce(new Error("No account"));
    const res = await call({
      userEmail: "ghost@example.com",
      tool: "rememberFact",
      args: { fact: "x" },
    });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "No account" });
  });
});
