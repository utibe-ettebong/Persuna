/**
 * MCP authorization ("Sign in with…") for remote MCP servers. Follows a 401
 * to the protected resource metadata (RFC 9728), then to the authorization
 * server metadata (RFC 8414, with OIDC discovery as a fallback), then runs
 * the authorization code flow with PKCE S256 and the resource parameter
 * (RFC 8707). Pure except for the HTTP calls, which take a fetch so tests
 * drive them against a fake authorization server.
 *
 * Clients register in this order: a pre-registered client id, then a Client
 * ID Metadata Document URL used as the client id, then Dynamic Client
 * Registration (deprecated upstream, kept as a fallback). Tokens are bound
 * to the issuer that minted them and the resource they were requested for,
 * and are never sent anywhere else.
 */
import { createHash, randomBytes } from "node:crypto";

type FetchFn = typeof fetch;

const REQUEST_TIMEOUT_MS = 20_000;

/** What the MCP server says about who may sign its users in (RFC 9728). */
export interface ProtectedResourceMetadata {
  /** The MCP server's own URL, echoed back for the client to check. */
  resource: string;
  /** Authorization servers that may mint tokens for it, in preference order. */
  authorizationServers: string[];
  scopesSupported: string[];
}

/** Where to send the user and where to redeem the code (RFC 8414 / OIDC). */
export interface AuthorizationServerMetadata {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string | null;
  scopesSupported: string[];
}

/** How Persuna identifies itself to the authorization server. */
export type McpOAuthClient =
  | { kind: "static"; clientId: string; clientSecret?: string }
  | { kind: "cimd"; url: string }
  | { kind: "dynamic" };

/**
 * Tokens for one MCP server, bound to the issuer that minted them and the
 * resource they were requested for. Only ever sent to those two parties.
 */
export interface McpTokenSet {
  accessToken: string;
  refreshToken: string | null;
  /** ms since epoch, or null when the server gave no expiry. */
  expiresAt: number | null;
  scope: string | null;
  issuer: string;
  resource: string;
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

/** Vendors whose MCP servers accept only pre-registered OAuth clients. */
export const MCP_VENDORS = ["slack", "asana", "zoom", "x", "github"] as const;
export type McpVendor = (typeof MCP_VENDORS)[number];
export const isMcpVendor = (value: string): value is McpVendor =>
  (MCP_VENDORS as readonly string[]).includes(value);

export const MCP_VENDOR_NAMES: Record<McpVendor, string> = {
  slack: "Slack",
  asana: "Asana",
  zoom: "Zoom",
  x: "X",
  github: "GitHub",
};

/** A random verifier and its S256 challenge for one sign-in attempt. */
export function createPkcePair(): PkcePair {
  const verifier = randomBytes(64).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

const sameUrl = (a: string, b: string) =>
  a.replace(/\/+$/, "").toLowerCase() === b.replace(/\/+$/, "").toLowerCase();

/**
 * The resource-metadata URL from a 401's WWW-Authenticate header, if any:
 * `Bearer error="invalid_token", resource_metadata="https://…"`.
 */
export function parseResourceMetadataUrl(header: string | null): string | null {
  if (!header) return null;
  const match = header.match(/resource_metadata="([^"]+)"/);
  return match?.[1] ?? null;
}

/**
 * The resource-metadata URL derived from the MCP endpoint itself (RFC 9728
 * §3.1), used when the 401 carries no header: the well-known path is
 * inserted before the endpoint's own path.
 */
export function resourceMetadataUrlFor(mcpUrl: string): string {
  const url = new URL(mcpUrl);
  const path = url.pathname === "/" ? "" : url.pathname;
  return `${url.origin}/.well-known/oauth-protected-resource${path}`;
}

/** Authorization-server metadata URLs for an issuer, RFC 8414 first, then OIDC. */
export function authorizationServerMetadataUrls(issuer: string): string[] {
  const url = new URL(issuer);
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
  const urls = path
    ? [`${url.origin}/.well-known/oauth-authorization-server${path}`]
    : [`${url.origin}/.well-known/oauth-authorization-server`];
  urls.push(`${url.origin}${path}/.well-known/openid-configuration`);
  return urls;
}

async function readJson(res: Response, what: string): Promise<Record<string, unknown>> {
  if (!res.ok) throw new Error(`${what} failed: HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

const str = (value: unknown) => (typeof value === "string" ? value : "");
const strArray = (value: unknown) =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

/** Fetches and checks the MCP server's protected resource metadata. */
export async function fetchResourceMetadata(
  metadataUrl: string,
  mcpUrl: string,
  fetchFn: FetchFn = fetch,
): Promise<ProtectedResourceMetadata> {
  const data = await readJson(
    await fetchFn(metadataUrl, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
    "Resource metadata",
  );
  const resource = str(data.resource);
  if (!resource || !sameUrl(resource, mcpUrl)) {
    throw new Error("That server's sign-in details don't match its address. Not continuing.");
  }
  const authorizationServers = strArray(data.authorization_servers);
  if (!authorizationServers.length) {
    throw new Error("That server names no sign-in provider. It may not support signing in.");
  }
  return { resource, authorizationServers, scopesSupported: strArray(data.scopes_supported) };
}

/** Fetches the authorization server's metadata, trying OIDC discovery when RFC 8414 404s. */
export async function fetchAuthorizationServerMetadata(
  issuer: string,
  fetchFn: FetchFn = fetch,
): Promise<AuthorizationServerMetadata> {
  const [first, ...rest] = authorizationServerMetadataUrls(issuer);
  let data: Record<string, unknown> | null = null;
  for (const url of [first, ...rest]) {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (res.status === 404) continue;
    data = await readJson(res, "Authorization server metadata");
    break;
  }
  if (!data) throw new Error("Authorization server metadata failed: HTTP 404");
  const metadataIssuer = str(data.issuer);
  if (!metadataIssuer || !sameUrl(metadataIssuer, issuer)) {
    throw new Error("That sign-in provider's details don't match. Not continuing.");
  }
  const authorizationEndpoint = str(data.authorization_endpoint);
  const tokenEndpoint = str(data.token_endpoint);
  if (!authorizationEndpoint || !tokenEndpoint) {
    throw new Error(
      "That sign-in provider is missing its endpoints. It may not support signing in.",
    );
  }
  return {
    issuer: metadataIssuer,
    authorizationEndpoint,
    tokenEndpoint,
    registrationEndpoint: str(data.registration_endpoint) || null,
    scopesSupported: strArray(data.scopes_supported),
  };
}

export interface DiscoveredAuth {
  resource: ProtectedResourceMetadata;
  authServer: AuthorizationServerMetadata;
}

/**
 * The full discovery chain for an MCP server: resource metadata (from the
 * 401's header, else derived from the endpoint URL), then the first
 * authorization server it names.
 */
export async function discoverAuthServer(
  mcpUrl: string,
  wwwAuthenticate: string | null,
  fetchFn: FetchFn = fetch,
): Promise<DiscoveredAuth> {
  const metadataUrl = parseResourceMetadataUrl(wwwAuthenticate) ?? resourceMetadataUrlFor(mcpUrl);
  const resource = await fetchResourceMetadata(metadataUrl, mcpUrl, fetchFn);
  const authServer = await fetchAuthorizationServerMetadata(
    resource.authorizationServers[0],
    fetchFn,
  );
  return { resource, authServer };
}

export interface AuthorizeInput {
  authServer: AuthorizationServerMetadata;
  clientId: string;
  redirectUri: string;
  /** The MCP server's URL, sent as the RFC 8707 resource parameter. */
  resource: string;
  scope?: string;
  state: string;
  codeChallenge: string;
}

/** The sign-in page URL: authorization code flow with PKCE S256 and the resource. */
export function authorizationUrl(input: AuthorizeInput): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    resource: input.resource,
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
  });
  if (input.scope) params.set("scope", input.scope);
  return `${input.authServer.authorizationEndpoint}?${params}`;
}

export interface RegisteredClient {
  clientId: string;
  clientSecret: string | null;
}

/**
 * Dynamic Client Registration (RFC 7591) as a last resort when there is no
 * pre-registered client and no Client ID Metadata Document.
 */
export async function registerClientDynamic(
  authServer: AuthorizationServerMetadata,
  input: { redirectUris: string[]; clientName: string },
  fetchFn: FetchFn = fetch,
): Promise<RegisteredClient> {
  if (!authServer.registrationEndpoint) {
    throw new Error("That sign-in provider takes only pre-registered apps.");
  }
  const data = await readJson(
    await fetchFn(authServer.registrationEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uris: input.redirectUris,
        client_name: input.clientName,
        application_type: "web",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }),
    "Client registration",
  );
  const clientId = str(data.client_id);
  if (!clientId) throw new Error("Client registration failed: no client id came back");
  return { clientId, clientSecret: str(data.client_secret) || null };
}

interface TokenRequest {
  /** Only the issuer and token endpoint are used; the service passes its stored pair. */
  authServer: Pick<AuthorizationServerMetadata, "issuer" | "tokenEndpoint">;
  resource: string;
  clientId: string;
  clientSecret?: string;
}

function tokenHeaders(clientId: string, clientSecret?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
  };
  if (clientSecret) {
    headers.authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  }
  return headers;
}

/**
 * Builds a token set from a token endpoint response, checking the issuer
 * (RFC 9207) when the server sends one and binding the tokens to it either way.
 */
function tokenSetFrom(
  data: Record<string, unknown>,
  expected: { issuer: string; resource: string },
  previousRefreshToken: string | null = null,
): McpTokenSet {
  const issuer = str(data.iss);
  if (issuer && !sameUrl(issuer, expected.issuer)) {
    throw new Error("Those tokens came from the wrong sign-in provider. Not continuing.");
  }
  const accessToken = str(data.access_token);
  if (!accessToken) throw new Error("Sign-in failed: no access token came back");
  const expiresIn = data.expires_in;
  return {
    accessToken,
    refreshToken:
      typeof data.refresh_token === "string" ? data.refresh_token : previousRefreshToken,
    expiresAt: typeof expiresIn === "number" ? Date.now() + (expiresIn - 60) * 1000 : null,
    scope: typeof data.scope === "string" ? data.scope : null,
    issuer: expected.issuer,
    resource: expected.resource,
  };
}

/** Redeems the code from the sign-in page for tokens bound to this server. */
export async function exchangeCode(
  input: TokenRequest & { code: string; redirectUri: string; codeVerifier: string },
  fetchFn: FetchFn = fetch,
): Promise<McpTokenSet> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
    resource: input.resource,
  });
  if (!input.clientSecret) body.set("client_id", input.clientId);
  const data = await readJson(
    await fetchFn(input.authServer.tokenEndpoint, {
      method: "POST",
      headers: tokenHeaders(input.clientId, input.clientSecret),
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }),
    "Sign-in",
  );
  return tokenSetFrom(data, { issuer: input.authServer.issuer, resource: input.resource });
}

/** A fresh access token from a refresh token, keeping the issuer binding. */
export async function refreshAccessToken(
  input: TokenRequest & { refreshToken: string; scope?: string },
  fetchFn: FetchFn = fetch,
): Promise<McpTokenSet> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
    resource: input.resource,
  });
  if (!input.clientSecret) body.set("client_id", input.clientId);
  if (input.scope) body.set("scope", input.scope);
  const data = await readJson(
    await fetchFn(input.authServer.tokenEndpoint, {
      method: "POST",
      headers: tokenHeaders(input.clientId, input.clientSecret),
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }),
    "Token refresh",
  );
  return tokenSetFrom(
    data,
    { issuer: input.authServer.issuer, resource: input.resource },
    input.refreshToken,
  );
}

/**
 * Whether these tokens may be used for this MCP server: the resource must be
 * the one they were requested for. Anything else is a token passed through
 * to another server, which never happens.
 */
export function tokenUsableFor(tokens: Pick<McpTokenSet, "resource">, resource: string): boolean {
  return sameUrl(tokens.resource, resource);
}

/**
 * Whether a failed MCP call asks for more scope: HTTP 403 carrying
 * insufficient_scope, in the body or the WWW-Authenticate header. The caller
 * re-runs sign-in asking for the wider scope.
 */
export function isInsufficientScope(
  status: number,
  body: string,
  wwwAuthenticate: string | null = null,
): boolean {
  if (status !== 403) return false;
  return (
    body.includes("insufficient_scope") ||
    (wwwAuthenticate?.includes("insufficient_scope") ?? false)
  );
}
