import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  authorizationUrl,
  createPkcePair,
  discoverAuthServer,
  exchangeCode,
  fetchAuthorizationServerMetadata,
  isInsufficientScope,
  parseResourceMetadataUrl,
  refreshAccessToken,
  registerClientDynamic,
  resourceMetadataUrlFor,
  tokenUsableFor,
  type AuthorizationServerMetadata,
} from "./auth";

const MCP_URL = "https://mcp.example.com/mcp";
const ISSUER = "https://auth.example.com";
const TOKEN_ENDPOINT = `${ISSUER}/token`;

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

const authServer: AuthorizationServerMetadata = {
  issuer: ISSUER,
  authorizationEndpoint: `${ISSUER}/authorize`,
  tokenEndpoint: TOKEN_ENDPOINT,
  registrationEndpoint: `${ISSUER}/register`,
  scopesSupported: ["read", "write"],
};

/**
 * A fake authorization server and resource metadata behind a fetch-shaped
 * function. Requests the test doesn't stub answer 404.
 */
function fakeAuth(overrides: Record<string, unknown> = {}) {
  const seen: { url: string; method: string; headers: Record<string, string>; body: string }[] = [];
  const routes: Record<string, unknown> = {
    [`/.well-known/oauth-protected-resource/mcp`]: RESOURCE_METADATA,
    [`/.well-known/oauth-authorization-server`]: AUTH_SERVER_METADATA,
    ...overrides,
  };
  const fetchFn = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers: Record<string, string> = {};
    for (const [k, v] of new Headers(init?.headers).entries()) headers[k] = v;
    seen.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: String(init?.body ?? ""),
    });
    const route = routes[url.pathname];
    if (route === undefined) return new Response("no such route", { status: 404 });
    if (typeof route === "function") {
      return (route as (body: URLSearchParams) => Response)(
        new URLSearchParams(String(init?.body ?? "")),
      );
    }
    return new Response(JSON.stringify(route), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, seen };
}

const tokenResponse = (extra: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      access_token: "access-1",
      refresh_token: "refresh-1",
      expires_in: 3600,
      scope: "read",
      iss: ISSUER,
      ...extra,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

describe("discovery", () => {
  it("follows the 401 header to resource metadata, then to the auth server", async () => {
    const { fetchFn, seen } = fakeAuth();
    const header = `Bearer error="invalid_token", resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"`;
    const found = await discoverAuthServer(MCP_URL, header, fetchFn);
    expect(found.resource.authorizationServers).toEqual([ISSUER]);
    expect(found.authServer.tokenEndpoint).toBe(TOKEN_ENDPOINT);
    expect(seen.map((s) => s.url)).toEqual([
      "https://mcp.example.com/.well-known/oauth-protected-resource/mcp",
      "https://auth.example.com/.well-known/oauth-authorization-server",
    ]);
  });

  it("derives the metadata URL when the 401 carries no header", async () => {
    const { fetchFn, seen } = fakeAuth();
    const found = await discoverAuthServer(MCP_URL, null, fetchFn);
    expect(found.authServer.issuer).toBe(ISSUER);
    expect(seen[0].url).toBe(resourceMetadataUrlFor(MCP_URL));
  });

  it("refuses metadata that names a different resource", async () => {
    const { fetchFn } = fakeAuth({
      [`/.well-known/oauth-protected-resource/mcp`]: {
        ...RESOURCE_METADATA,
        resource: "https://evil.example.com/mcp",
      },
    });
    await expect(discoverAuthServer(MCP_URL, null, fetchFn)).rejects.toThrow(/don't match/);
  });

  it("falls back to OIDC discovery when RFC 8414 404s", async () => {
    const { fetchFn, seen } = fakeAuth({
      [`/.well-known/oauth-authorization-server`]: undefined,
      [`/.well-known/openid-configuration`]: AUTH_SERVER_METADATA,
    });
    // undefined removes the stubbed route, so it 404s.
    const found = await fetchAuthorizationServerMetadata(ISSUER, fetchFn);
    expect(found.tokenEndpoint).toBe(TOKEN_ENDPOINT);
    expect(seen.map((s) => new URL(s.url).pathname)).toEqual([
      "/.well-known/oauth-authorization-server",
      "/.well-known/openid-configuration",
    ]);
  });

  it("refuses auth server metadata from the wrong issuer", async () => {
    const { fetchFn } = fakeAuth({
      [`/.well-known/oauth-authorization-server`]: {
        ...AUTH_SERVER_METADATA,
        issuer: "https://evil.example.com",
      },
    });
    await expect(fetchAuthorizationServerMetadata(ISSUER, fetchFn)).rejects.toThrow(/don't match/);
  });
});

describe("parseResourceMetadataUrl", () => {
  it("pulls the URL out of a 401 header, else null", () => {
    expect(
      parseResourceMetadataUrl(
        'Bearer error="invalid_token", resource_metadata="https://a.example/x"',
      ),
    ).toBe("https://a.example/x");
    expect(parseResourceMetadataUrl("Bearer")).toBeNull();
    expect(parseResourceMetadataUrl(null)).toBeNull();
  });
});

describe("resourceMetadataUrlFor", () => {
  it("inserts the well-known path before the endpoint path", () => {
    expect(resourceMetadataUrlFor("https://mcp.example.com/mcp")).toBe(
      "https://mcp.example.com/.well-known/oauth-protected-resource/mcp",
    );
    expect(resourceMetadataUrlFor("https://mcp.example.com/")).toBe(
      "https://mcp.example.com/.well-known/oauth-protected-resource",
    );
  });
});

describe("PKCE and the sign-in URL", () => {
  it("makes a verifier whose S256 is the challenge", () => {
    const { verifier, challenge } = createPkcePair();
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(challenge);
  });

  it("sends code flow, PKCE S256, state and the resource", () => {
    const url = new URL(
      authorizationUrl({
        authServer,
        clientId: "persuna",
        redirectUri: "https://app.example.com/api/mcp/callback",
        resource: MCP_URL,
        scope: "read write",
        state: "state-1",
        codeChallenge: "challenge-1",
      }),
    );
    expect(url.origin + url.pathname).toBe(`${ISSUER}/authorize`);
    const params = url.searchParams;
    expect(params.get("response_type")).toBe("code");
    expect(params.get("client_id")).toBe("persuna");
    expect(params.get("resource")).toBe(MCP_URL);
    expect(params.get("scope")).toBe("read write");
    expect(params.get("state")).toBe("state-1");
    expect(params.get("code_challenge")).toBe("challenge-1");
    expect(params.get("code_challenge_method")).toBe("S256");
  });
});

describe("registerClientDynamic", () => {
  it("posts the redirect URIs to the registration endpoint", async () => {
    const { fetchFn, seen } = fakeAuth({
      [`/register`]: () => new Response(JSON.stringify({ client_id: "dyn-1" }), { status: 201 }),
    });
    const client = await registerClientDynamic(
      authServer,
      { redirectUris: ["https://app.example.com/api/mcp/callback"], clientName: "Persuna" },
      fetchFn,
    );
    expect(client).toEqual({ clientId: "dyn-1", clientSecret: null });
    const call = seen.find((s) => s.url === `${ISSUER}/register`)!;
    expect(call.method).toBe("POST");
    expect(JSON.parse(call.body).redirect_uris).toEqual([
      "https://app.example.com/api/mcp/callback",
    ]);
    expect(JSON.parse(call.body).application_type).toBe("web");
  });

  it("refuses when the provider takes only pre-registered apps", async () => {
    const { fetchFn } = fakeAuth();
    await expect(
      registerClientDynamic(
        { ...authServer, registrationEndpoint: null },
        { redirectUris: ["https://app.example.com/cb"], clientName: "P" },
        fetchFn,
      ),
    ).rejects.toThrow(/pre-registered/);
  });
});

describe("exchangeCode", () => {
  const input = {
    authServer,
    resource: MCP_URL,
    clientId: "persuna",
    code: "code-1",
    redirectUri: "https://app.example.com/api/mcp/callback",
    codeVerifier: "verifier-1",
  };

  it("redeems the code with the verifier and resource, binding issuer and resource", async () => {
    const { fetchFn, seen } = fakeAuth({ [`/token`]: () => tokenResponse() });
    const tokens = await exchangeCode(input, fetchFn);
    expect(tokens.accessToken).toBe("access-1");
    expect(tokens.refreshToken).toBe("refresh-1");
    expect(tokens.issuer).toBe(ISSUER);
    expect(tokens.resource).toBe(MCP_URL);
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());
    const call = seen.find((s) => s.url === TOKEN_ENDPOINT)!;
    const body = new URLSearchParams(call.body);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code_verifier")).toBe("verifier-1");
    expect(body.get("resource")).toBe(MCP_URL);
    expect(body.get("client_id")).toBe("persuna");
  });

  it("uses Basic auth when the client has a secret", async () => {
    const { fetchFn, seen } = fakeAuth({ [`/token`]: () => tokenResponse() });
    await exchangeCode({ ...input, clientSecret: "secret-1" }, fetchFn);
    const call = seen.find((s) => s.url === TOKEN_ENDPOINT)!;
    expect(call.headers.authorization).toBe(
      `Basic ${Buffer.from("persuna:secret-1").toString("base64")}`,
    );
    expect(new URLSearchParams(call.body).get("client_id")).toBeNull();
  });

  it("accepts tokens without an iss, still bound to the expected issuer", async () => {
    const { fetchFn } = fakeAuth({ [`/token`]: () => tokenResponse({ iss: undefined }) });
    const tokens = await exchangeCode(input, fetchFn);
    expect(tokens.issuer).toBe(ISSUER);
  });

  it("refuses tokens from the wrong issuer", async () => {
    const { fetchFn } = fakeAuth({
      [`/token`]: () => tokenResponse({ iss: "https://evil.example.com" }),
    });
    await expect(exchangeCode(input, fetchFn)).rejects.toThrow(/wrong sign-in provider/);
  });

  it("surfaces token endpoint errors", async () => {
    const { fetchFn } = fakeAuth({
      [`/token`]: () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
    });
    await expect(exchangeCode(input, fetchFn)).rejects.toThrow(/HTTP 400/);
  });
});

describe("refreshAccessToken", () => {
  const input = {
    authServer,
    resource: MCP_URL,
    clientId: "persuna",
    refreshToken: "refresh-1",
  };

  it("refreshes without asking the user again, adopting a rotated token", async () => {
    const { fetchFn, seen } = fakeAuth({
      [`/token`]: () => tokenResponse({ access_token: "access-2", refresh_token: "refresh-2" }),
    });
    const tokens = await refreshAccessToken(input, fetchFn);
    expect(tokens.accessToken).toBe("access-2");
    expect(tokens.refreshToken).toBe("refresh-2");
    expect(tokens.issuer).toBe(ISSUER);
    const body = new URLSearchParams(seen.find((s) => s.url === TOKEN_ENDPOINT)!.body);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("resource")).toBe(MCP_URL);
  });

  it("keeps the old refresh token when the server sends none", async () => {
    const { fetchFn } = fakeAuth({ [`/token`]: () => tokenResponse({ refresh_token: undefined }) });
    const tokens = await refreshAccessToken(input, fetchFn);
    expect(tokens.refreshToken).toBe("refresh-1");
  });

  it("refuses refreshed tokens from the wrong issuer", async () => {
    const { fetchFn } = fakeAuth({
      [`/token`]: () => tokenResponse({ iss: "https://evil.example.com" }),
    });
    await expect(refreshAccessToken(input, fetchFn)).rejects.toThrow(/wrong sign-in provider/);
  });
});

describe("tokenUsableFor", () => {
  it("allows the requested resource only, never another server", async () => {
    const { fetchFn } = fakeAuth({ [`/token`]: () => tokenResponse() });
    const tokens = await exchangeCode(
      {
        authServer,
        resource: MCP_URL,
        clientId: "persuna",
        code: "code-1",
        redirectUri: "https://app.example.com/api/mcp/callback",
        codeVerifier: "verifier-1",
      },
      fetchFn,
    );
    expect(tokenUsableFor(tokens, MCP_URL)).toBe(true);
    expect(tokenUsableFor(tokens, "https://other.example.com/mcp")).toBe(false);
  });
});

describe("isInsufficientScope", () => {
  it("spots the step-up signal on 403 only", () => {
    expect(isInsufficientScope(403, "insufficient_scope")).toBe(true);
    expect(isInsufficientScope(403, "", 'Bearer error="insufficient_scope", scope="write"')).toBe(
      true,
    );
    expect(isInsufficientScope(403, "forbidden")).toBe(false);
    expect(isInsufficientScope(401, "insufficient_scope")).toBe(false);
  });
});
