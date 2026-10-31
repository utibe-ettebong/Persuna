import { beforeEach, describe, expect, it, vi } from "vitest";
import { getUser } from "@/lib/auth/session";
import { reportFirstAudio } from "@/lib/persuna/voice-metrics";
import { POST } from "./route";

vi.mock("@/lib/auth/session", () => ({ getUser: vi.fn() }));
vi.mock("@/lib/persuna/voice-metrics", () => ({ reportFirstAudio: vi.fn() }));

const call = (body: unknown) =>
  POST(
    new Request("http://test/api/persuna/voice-first-audio", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getUser).mockResolvedValue({ id: "user-1" } as never);
});

describe("POST /api/persuna/voice-first-audio", () => {
  it("needs a signed-in user", async () => {
    vi.mocked(getUser).mockResolvedValue(null);
    const res = await call({ turn: "t1", ms: 1200 });
    expect(res.status).toBe(401);
    expect(reportFirstAudio).not.toHaveBeenCalled();
  });

  it("joins a report to its turn, and says when it landed", async () => {
    vi.mocked(reportFirstAudio).mockResolvedValue(true);
    const res = await call({ turn: "t1", ms: 1200 });
    expect(res.status).toBe(200);
    expect(reportFirstAudio).toHaveBeenCalledWith("user-1", "t1", 1200);
  });

  it("ignores a stray report quietly, never an error", async () => {
    vi.mocked(reportFirstAudio).mockResolvedValue(false);
    const res = await call({ turn: "no-such-turn", ms: 1200 });
    expect(res.status).toBe(204);
  });

  it("refuses a malformed report", async () => {
    for (const body of [
      { turn: "t1" },
      { ms: 1200 },
      { turn: "", ms: 5 },
      { turn: "t1", ms: "soon" },
    ]) {
      const res = await call(body);
      expect(res.status).toBe(400);
    }
    expect(reportFirstAudio).not.toHaveBeenCalled();
  });
});
