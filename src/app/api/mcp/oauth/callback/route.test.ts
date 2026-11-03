import { beforeEach, describe, expect, it, vi } from "vitest";
import { cookies } from "next/headers";
import { getUser } from "@/lib/auth/session";
import { completeMcpOAuth } from "@/lib/mcp/service";
import { GET } from "./route";

process.env.DATABASE_URL ??= "postgres://localhost:5432/persuna_test";

vi.mock("@/lib/auth/session", () => ({ getUser: vi.fn(), actorOf: () => "user:ada@example.com" }));
vi.mock("@/lib/mcp/service", async (original) => ({
  ...((await original()) as Record<string, unknown>),
  completeMcpOAuth: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

const USER = { id: "user-1", name: "Ada", email: "ada@example.com", isAdmin: false };

const call = (query: string, signedIn = true, secret: string | undefined = "verifier-1.") => {
  vi.mocked(getUser).mockResolvedValue(signedIn ? USER : null);
  vi.mocked(cookies).mockResolvedValue({
    get: () => (secret ? { value: secret } : undefined),
  } as never);
  return GET(new Request(`https://app.example.com/api/mcp/oauth/callback${query}`));
};

const location = (res: Response) => decodeURIComponent(res.headers.get("location") ?? "");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(completeMcpOAuth).mockResolvedValue({
    id: "srv-1",
    name: "Linear",
    url: "https://mcp.example.com/mcp",
    authType: "oauth",
    tools: [{ name: "list_issues", description: "List" }],
  });
});

describe("GET /api/mcp/oauth/callback", () => {
  it("sends signed-out browsers to sign in", async () => {
    const res = await call("?code=c&state=s", false);
    expect(res.status).toBe(307);
    expect(location(res)).toContain("/sign-in?next=/persuna#apps");
  });

  it("bounces back without a code or state", async () => {
    const res = await call("?code=c");
    expect(location(res)).toContain("That server wasn't connected.");
    expect(completeMcpOAuth).not.toHaveBeenCalled();
  });

  it("completes the sign-in and reports back on the Persuna page", async () => {
    const res = await call("?code=code-1&state=state-1");
    expect(completeMcpOAuth).toHaveBeenCalledWith(
      "user-1",
      {
        code: "code-1",
        state: "state-1",
        secret: "verifier-1.",
        redirectUri: "https://app.example.com/api/mcp/oauth/callback",
      },
      "user:ada@example.com",
    );
    expect(location(res)).toContain("Connected Linear (1 tools).");
  });

  it("reports failures back on the Persuna page", async () => {
    vi.mocked(completeMcpOAuth).mockRejectedValue(new Error("That sign-in expired."));
    const res = await call("?code=code-1&state=state-1");
    expect(location(res)).toContain("That sign-in expired.");
  });
});
