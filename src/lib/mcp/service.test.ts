import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import type { McpOAuthCredentials, McpServer } from "@/db/schema";
import { audit } from "@/lib/audit";
import { seal, unseal } from "@/lib/connections/crypto";
import {
  beginMcpOAuth,
  completeMcpOAuth,
  confirmMcpCall,
  proposeMcpCall,
  type McpServerView,
} from "./service";

process.env.DATABASE_URL ??= "postgres://localhost:5432/persuna_test";
process.env.CONNECTIONS_KEY = "test-connections-key-0123456789abcdef";

vi.mock("@/db/client", async (original) => ({
  ...(await original<typeof import("@/db/client")>()),
  db: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

const KEY = "test-connections-key-0123456789abcdef";
const MCP_URL = "https://mcp.example.com/mcp";
const ISSUER = "https://auth.example.com";
const TOKEN_ENDPOINT = `${ISSUER}/token`;
const REDIRECT = "https://app.example.com/api/mcp/callback";

const RESOURCE_METADATA = {
  resource: MCP_URL,
  authorization_servers: [ISSUER],
  scopes_supported: ["read", "write"],
};

const AUTH_SERVER_METADATA = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: TOKEN_ENDPOINT,
  registration_endpoint: `${ISSUER}/register`,
  scopes_supported: ["read", "write"],
};

/** A fake auth provider, resource metadata, and MCP server behind one fetch. */
function fakeProvider(tokenResponder?: (body: URLSearchParams) => Response) {
  const seen: { url: string; method: string; auth: string | null; body: string }[] = [];
  const json = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  const fetchFn = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    seen.push({
      url: String(input),
      method: init?.method ?? "GET",
      auth: headers.get("authorization"),
      body: String(init?.body ?? ""),
    });
    const key = `${url.host}${url.pathname}`;
    if (key === "mcp.example.com/.well-known/oauth-protected-resource/mcp") {
      return json(RESOURCE_METADATA);
    }
    if (key === "auth.example.com/.well-known/oauth-authorization-server") {
      return json(AUTH_SERVER_METADATA);
    }
    if (key === "auth.example.com/register") {
      return json({ client_id: "dyn-1", client_secret: "dyn-secret" }, 201);
    }
    if (key === "auth.example.com/token") {
      if (tokenResponder) return tokenResponder(new URLSearchParams(String(init?.body ?? "")));
      return json({
        access_token: "access-1",
        refresh_token: "refresh-1",
        expires_in: 3600,
        scope: "read",
        iss: ISSUER,
      });
    }
    if (key === "mcp.example.com/mcp") {
      const rpc = JSON.parse(String(init?.body)) as { id?: number; method: string };
      if (rpc.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (rpc.method === "initialize") {
        return json({ jsonrpc: "2.0", id: rpc.id, result: { protocolVersion: "2025-03-26" } });
      }
      if (rpc.method === "tools/list") {
        return json({
          jsonrpc: "2.0",
          id: rpc.id,
          result: { tools: [{ name: "list_issues", description: "List issues" }] },
        });
      }
      if (rpc.method === "tools/call") {
        return json({
          jsonrpc: "2.0",
          id: rpc.id,
          result: { content: [{ type: "text", text: "called list_issues" }] },
        });
      }
      return json({ jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: "unknown" } });
    }
    return new Response("no such route", { status: 404 });
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, seen };
}

/** The drizzle chains the service uses, with hooks to capture writes. */
function stubDb(hooks: {
  selectRows?: unknown[];
  onInsert?: (values: Record<string, unknown>) => void;
  insertedRow?: unknown;
  onUpdate?: (values: Record<string, unknown>) => void;
}) {
  vi.mocked(db).mockReturnValue({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => hooks.selectRows ?? [],
        }),
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        hooks.onInsert?.(values);
        return {
          onConflictDoUpdate: () => ({
            returning: async () => [hooks.insertedRow ?? { id: "srv-1", ...values }],
          }),
        };
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        hooks.onUpdate?.(values);
        return { where: async () => [] };
      },
    }),
  } as never);
}

function oauthCreds(overrides: Partial<McpOAuthCredentials> = {}): McpOAuthCredentials {
  return {
    issuer: ISSUER,
    resource: MCP_URL,
    tokenEndpoint: TOKEN_ENDPOINT,
    clientId: "dyn-1",
    clientSecret: seal("dyn-secret", KEY),
    accessToken: seal("access-1", KEY),
    refreshToken: seal("refresh-1", KEY),
    expiresAt: Date.now() + 3600_000,
    scope: "read",
    ...overrides,
  };
}

function serverRow(overrides: Partial<McpServer> = {}): McpServer {
  return {
    id: "srv-1",
    userId: "user-1",
    name: "Linear",
    url: MCP_URL,
    token: "",
    authType: "oauth",
    oauth: oauthCreds(),
    tools: [{ name: "list_issues", description: "List issues" }],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const serverView = (row: McpServer): McpServerView => ({
  id: row.id,
  name: row.name,
  url: row.url,
  authType: row.authType === "oauth" ? "oauth" : "token",
  tools: row.tools,
});

beforeEach(() => vi.clearAllMocks());

describe("beginMcpOAuth", () => {
  it("discovers, registers, and returns the sign-in URL with state and secret", async () => {
    const { fetchFn, seen } = fakeProvider();
    stubDb({});
    const begun = await beginMcpOAuth(
      "user-1",
      { name: "Linear", url: MCP_URL, scope: "read", redirectUri: REDIRECT },
      "user:ada@example.com",
      fetchFn,
    );
    const url = new URL(begun.url);
    expect(`${url.origin}${url.pathname}`).toBe(`${ISSUER}/authorize`);
    expect(url.searchParams.get("client_id")).toBe("dyn-1");
    expect(url.searchParams.get("resource")).toBe(MCP_URL);
    expect(url.searchParams.get("state")).toBe(begun.state);
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(begun.secret).toContain(".");
    expect(seen.some((s) => s.url === `${ISSUER}/register`)).toBe(true);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "mcp.oauth_started",
        details: { name: "Linear", issuer: ISSUER },
      }),
    );
  });

  it("uses a pre-registered client and skips registration", async () => {
    const { fetchFn, seen } = fakeProvider();
    stubDb({});
    const begun = await beginMcpOAuth(
      "user-1",
      {
        name: "Linear",
        url: MCP_URL,
        redirectUri: REDIRECT,
        client: { clientId: "static-1", clientSecret: "static-secret" },
      },
      "user:ada@example.com",
      fetchFn,
    );
    expect(new URL(begun.url).searchParams.get("client_id")).toBe("static-1");
    expect(begun.secret.endsWith(".static-secret")).toBe(true);
    expect(seen.some((s) => s.url === `${ISSUER}/register`)).toBe(false);
  });

  it("uses a Client ID Metadata Document URL as the client id", async () => {
    const { fetchFn, seen } = fakeProvider();
    stubDb({});
    const begun = await beginMcpOAuth(
      "user-1",
      {
        name: "Linear",
        url: MCP_URL,
        redirectUri: REDIRECT,
        client: { cimdUrl: "https://app.example.com/mcp-client.json" },
      },
      "user:ada@example.com",
      fetchFn,
    );
    expect(new URL(begun.url).searchParams.get("client_id")).toBe(
      "https://app.example.com/mcp-client.json",
    );
    expect(seen.some((s) => s.url === `${ISSUER}/register`)).toBe(false);
  });

  it("refuses a non-http URL", async () => {
    const { fetchFn } = fakeProvider();
    stubDb({});
    await expect(
      beginMcpOAuth(
        "user-1",
        { name: "X", url: "stdio:linear", redirectUri: REDIRECT },
        "user:a@b.c",
        fetchFn,
      ),
    ).rejects.toThrow(/http\(s\) URL/);
  });
});

describe("completeMcpOAuth", () => {
  it("trades the code, stores sealed credentials, and lists tools", async () => {
    const { fetchFn } = fakeProvider();
    const begun = await beginMcpOAuth(
      "user-1",
      { name: "Linear", url: MCP_URL, redirectUri: REDIRECT },
      "user:ada@example.com",
      fetchFn,
    );
    let stored: Record<string, unknown> = {};
    stubDb({ onInsert: (values) => (stored = values) });
    const view = await completeMcpOAuth(
      "user-1",
      { state: begun.state, secret: begun.secret, code: "code-1", redirectUri: REDIRECT },
      "user:ada@example.com",
      fetchFn,
    );
    expect(view.authType).toBe("oauth");
    expect(view.tools.map((t) => t.name)).toEqual(["list_issues"]);
    expect(stored.authType).toBe("oauth");
    const oauth = stored.oauth as McpOAuthCredentials;
    expect(oauth.issuer).toBe(ISSUER);
    expect(oauth.resource).toBe(MCP_URL);
    expect(oauth.clientId).toBe("dyn-1");
    expect(unseal(oauth.accessToken, KEY)).toBe("access-1");
    expect(unseal(oauth.refreshToken!, KEY)).toBe("refresh-1");
    expect(unseal(oauth.clientSecret!, KEY)).toBe("dyn-secret");
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "mcp.oauth_connected",
        details: { name: "Linear", tools: 1 },
      }),
    );
  });

  it("rejects a forged state, another user's state, and a missing secret", async () => {
    const { fetchFn } = fakeProvider();
    stubDb({});
    const begun = await beginMcpOAuth(
      "user-1",
      { name: "Linear", url: MCP_URL, redirectUri: REDIRECT },
      "user:ada@example.com",
      fetchFn,
    );
    const input = {
      state: begun.state,
      secret: begun.secret,
      code: "code-1",
      redirectUri: REDIRECT,
    };
    await expect(
      completeMcpOAuth("user-1", { ...input, state: "forged" }, "user:ada@example.com", fetchFn),
    ).rejects.toThrow(/expired or wasn't started/);
    await expect(
      completeMcpOAuth("user-2", input, "user:bob@example.com", fetchFn),
    ).rejects.toThrow(/expired or wasn't started/);
    await expect(
      completeMcpOAuth("user-1", { ...input, secret: "" }, "user:ada@example.com", fetchFn),
    ).rejects.toThrow(/expired or wasn't started/);
  });
});

describe("approved calls on OAuth servers", () => {
  it("calls with the stored token when fresh, without refreshing", async () => {
    const row = serverRow();
    const { fetchFn, seen } = fakeProvider();
    stubDb({ selectRows: [row] });
    const pending = proposeMcpCall("user-1", serverView(row), "list_issues", { n: 1 });
    const result = await confirmMcpCall("user-1", pending.token, "user:ada@example.com", fetchFn);
    expect(result.output).toBe("called list_issues");
    expect(seen.some((s) => s.url === TOKEN_ENDPOINT)).toBe(false);
    const call = seen.find((s) => s.url === MCP_URL && s.body.includes("tools/call"));
    expect(call?.auth).toBe("Bearer access-1");
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "mcp.call",
        details: { server: "Linear", tool: "list_issues", isError: false },
      }),
    );
  });

  it("refreshes an expired token, stores it, and audits the refresh", async () => {
    const row = serverRow({ oauth: oauthCreds({ expiresAt: Date.now() - 1000 }) });
    const { fetchFn, seen } = fakeProvider(
      () =>
        new Response(
          JSON.stringify({
            access_token: "access-2",
            refresh_token: "refresh-2",
            expires_in: 3600,
            iss: ISSUER,
          }),
          { status: 200 },
        ),
    );
    let updated: Record<string, unknown> = {};
    stubDb({ selectRows: [row], onUpdate: (values) => (updated = values) });
    const pending = proposeMcpCall("user-1", serverView(row), "list_issues", { n: 2 });
    await confirmMcpCall("user-1", pending.token, "user:ada@example.com", fetchFn);
    const next = (updated.oauth ?? {}) as McpOAuthCredentials;
    expect(unseal(next.accessToken, KEY)).toBe("access-2");
    expect(unseal(next.refreshToken!, KEY)).toBe("refresh-2");
    const call = seen.find((s) => s.url === MCP_URL && s.body.includes("tools/call"));
    expect(call?.auth).toBe("Bearer access-2");
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "mcp.oauth_refreshed", details: { name: "Linear" } }),
    );
  });

  it("asks for a reconnect when expired without a refresh token", async () => {
    const row = serverRow({
      oauth: oauthCreds({ expiresAt: Date.now() - 1000, refreshToken: null }),
    });
    const { fetchFn } = fakeProvider();
    stubDb({ selectRows: [row] });
    const pending = proposeMcpCall("user-1", serverView(row), "list_issues", { n: 3 });
    await expect(
      confirmMcpCall("user-1", pending.token, "user:ada@example.com", fetchFn),
    ).rejects.toThrow(/Reconnect the server/);
  });

  it("never sends tokens to another server", async () => {
    const row = serverRow({ url: "https://other.example.com/mcp" });
    const { fetchFn, seen } = fakeProvider();
    stubDb({ selectRows: [row] });
    const pending = proposeMcpCall("user-1", serverView(row), "list_issues", { n: 4 });
    await expect(
      confirmMcpCall("user-1", pending.token, "user:ada@example.com", fetchFn),
    ).rejects.toThrow(/another server/);
    expect(seen.filter((s) => s.auth?.startsWith("Bearer "))).toEqual([]);
  });

  it("token-auth rows still use the fixed token", async () => {
    const row = serverRow({ authType: "token", oauth: null, token: seal("fixed-1", KEY) });
    const { fetchFn, seen } = fakeProvider();
    stubDb({ selectRows: [row] });
    const pending = proposeMcpCall("user-1", serverView(row), "list_issues", { n: 5 });
    const result = await confirmMcpCall("user-1", pending.token, "user:ada@example.com", fetchFn);
    expect(result.output).toBe("called list_issues");
    const call = seen.find((s) => s.url === MCP_URL && s.body.includes("tools/call"));
    expect(call?.auth).toBe("Bearer fixed-1");
    expect(seen.some((s) => s.url === TOKEN_ENDPOINT)).toBe(false);
  });
});
