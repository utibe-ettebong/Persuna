import { beforeEach, describe, expect, it, vi } from "vitest";
import { getUser } from "@/lib/auth/session";
import { MCP_OAUTH_COOKIE, beginMcpOAuth } from "@/lib/mcp/service";
import { POST } from "./route";

process.env.DATABASE_URL ??= "postgres://localhost:5432/persuna_test";

vi.mock("@/lib/auth/session", () => ({ getUser: vi.fn(), actorOf: () => "user:ada@example.com" }));
vi.mock("@/lib/mcp/service", async (original) => ({
  ...((await original()) as Record<string, unknown>),
  beginMcpOAuth: vi.fn(),
}));

const USER = { id: "user-1", name: "Ada", email: "ada@example.com", isAdmin: false };

const call = (body: unknown, signedIn = true) => {
  vi.mocked(getUser).mockResolvedValue(signedIn ? USER : null);
  return POST(
    new Request("https://app.example.com/api/mcp/oauth/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(beginMcpOAuth).mockResolvedValue({
    url: "https://auth.example.com/authorize?x=1",
    state: "state-1",
    secret: "verifier-1.",
  });
});

describe("POST /api/mcp/oauth/start", () => {
  it("refuses signed-out browsers", async () => {
    const res = await call({ name: "L", url: "https://mcp.example.com/mcp" }, false);
    expect(res.status).toBe(401);
    expect(beginMcpOAuth).not.toHaveBeenCalled();
  });

  it("refuses bad input and unknown vendors", async () => {
    expect((await call({ name: "", url: "" })).status).toBe(400);
    const unknown = await call({ name: "L", url: "https://mcp.example.com/mcp", vendor: "nope" });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: "Unknown vendor." });
  });

  it("refuses a vendor with no client configured", async () => {
    const res = await call({ name: "L", url: "https://mcp.example.com/mcp", vendor: "github" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "GitHub isn't set up on this server yet." });
  });

  it("begins with the CIMD client by default, setting the secret cookie", async () => {
    const res = await call({ name: "Linear", url: "https://mcp.example.com/mcp", scope: "read" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://auth.example.com/authorize?x=1" });
    expect(beginMcpOAuth).toHaveBeenCalledWith(
      "user-1",
      {
        name: "Linear",
        url: "https://mcp.example.com/mcp",
        scope: "read",
        redirectUri: "https://app.example.com/api/mcp/oauth/callback",
        client: { cimdUrl: "https://app.example.com/api/mcp/client-metadata" },
      },
      "user:ada@example.com",
    );
    expect(res.cookies.get(MCP_OAUTH_COOKIE)?.value).toBe("verifier-1.");
  });

  it("passes sign-in failures back as 400", async () => {
    vi.mocked(beginMcpOAuth).mockRejectedValue(new Error("No sign-in provider here."));
    const res = await call({ name: "L", url: "https://mcp.example.com/mcp" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "No sign-in provider here." });
  });
});
