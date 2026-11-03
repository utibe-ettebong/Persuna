/**
 * MCP client side: remote MCP servers the user connected so Persuna can use
 * their tools (Slack, Linear, GitHub, Figma, databases…). Tokens are sealed
 * with CONNECTIONS_KEY like connected-app tokens. Every tool call goes
 * through the same ask-before-acting flow as Gmail sends: Persuna proposes,
 * the user sees a preview and approves, and the signed one-shot token is
 * what authorises the call.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  mcpServers,
  type McpOAuthCredentials,
  type McpServer,
  type McpToolInfo,
} from "@/db/schema";
import { audit, type Actor } from "@/lib/audit";
import { env } from "@/env";
import { connectionsKey } from "@/lib/connections/service";
import { readToken, seal, signToken, unseal } from "@/lib/connections/crypto";
import {
  authorizationUrl,
  createPkcePair,
  discoverAuthServer,
  exchangeCode,
  refreshAccessToken,
  registerClientDynamic,
  tokenUsableFor,
  type McpVendor,
} from "./auth";
import { McpClient } from "./client";

/** How long a proposed tool call waits for the user's OK. */
const CONFIRM_TTL_MS = 15 * 60_000;

function requireKey(): string {
  const key = connectionsKey();
  if (!key) throw new Error("MCP servers are not set up on this deployment (CONNECTIONS_KEY).");
  return key;
}

/** A connected server as shown to the user and the model. */
export interface McpServerView {
  id: string;
  name: string;
  url: string;
  authType: "token" | "oauth";
  tools: McpToolInfo[];
}

function view(row: McpServer): McpServerView {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    authType: row.authType === "oauth" ? "oauth" : "token",
    tools: row.tools ?? [],
  };
}

export async function listMcpServers(userId: string): Promise<McpServerView[]> {
  const rows = await db().select().from(mcpServers).where(eq(mcpServers.userId, userId));
  return rows.map(view);
}

async function serverRow(userId: string, serverId: string): Promise<McpServer> {
  const [row] = await db()
    .select()
    .from(mcpServers)
    .where(and(eq(mcpServers.id, serverId), eq(mcpServers.userId, userId)))
    .limit(1);
  if (!row) throw new Error("That MCP server is no longer connected.");
  return row;
}

async function clientFor(row: McpServer, fetchFn?: typeof fetch): Promise<McpClient> {
  return new McpClient(row.url, await serverAccessToken(row, fetchFn), fetchFn);
}

/** A trimmed http(s) server URL, or an error the user can act on. */
function checkedServerUrl(url: string): string {
  const trimmed = url.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("That server address is not a valid URL.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("MCP servers are connected by http(s) URL in this version.");
  }
  return trimmed;
}

/**
 * Connects a server: discovers its tools first, and only stores it when the
 * endpoint answers as MCP. Returns the stored server with its tools.
 */
export async function connectMcpServer(
  userId: string,
  input: { name: string; url: string; token?: string },
  actor: Actor,
  fetchFn?: typeof fetch,
): Promise<McpServerView> {
  const name = input.name.trim();
  if (!name) throw new Error("Give the server a name.");
  const url = checkedServerUrl(input.url);
  const probe = new McpClient(url, input.token?.trim() ?? "", fetchFn);
  const tools = await probe.listTools();
  const sealed = input.token?.trim() ? seal(input.token.trim(), requireKey()) : "";
  const [row] = await db()
    .insert(mcpServers)
    .values({
      userId,
      name,
      url,
      token: sealed,
      authType: "token",
      oauth: null,
      tools: tools.map((t) => ({ name: t.name, description: t.description.slice(0, 500) })),
    })
    .onConflictDoUpdate({
      target: [mcpServers.userId, mcpServers.url],
      set: {
        name,
        token: sealed,
        authType: "token",
        oauth: null,
        tools: tools.map((t) => ({ name: t.name, description: t.description.slice(0, 500) })),
        updatedAt: new Date(),
      },
    })
    .returning();
  await audit({
    actor,
    action: "mcp.connect",
    entityType: "mcp_server",
    entityId: row.id,
    details: { name, tools: tools.length },
  });
  return view(row);
}

export async function disconnectMcpServer(userId: string, serverId: string, actor: Actor) {
  const row = await serverRow(userId, serverId);
  await db().delete(mcpServers).where(eq(mcpServers.id, row.id));
  await audit({
    actor,
    action: "mcp.disconnect",
    entityType: "mcp_server",
    entityId: row.id,
    details: { name: row.name },
  });
}

/**
 * A client for one of the user's MCP servers, with a working access token
 * (fixed token, or OAuth refreshed when expired). For the jobs runner: job
 * calls are approved through the job, not the chat confirm flow.
 */
export async function mcpServerClient(
  userId: string,
  serverId: string,
  fetchFn?: typeof fetch,
): Promise<{ client: McpClient; server: McpServerView }> {
  const row = await serverRow(userId, serverId);
  return { client: await clientFor(row, fetchFn), server: view(row) };
}

/** Re-runs tool discovery for a connected server and caches the result. */
export async function refreshMcpTools(userId: string, serverId: string, fetchFn?: typeof fetch) {
  const row = await serverRow(userId, serverId);
  const tools = await (await clientFor(row, fetchFn)).listTools();
  const cached = tools.map((t) => ({ name: t.name, description: t.description.slice(0, 500) }));
  await db()
    .update(mcpServers)
    .set({ tools: cached, updatedAt: new Date() })
    .where(eq(mcpServers.id, row.id));
  return cached;
}

/* ---------- OAuth ("Sign in with…") ---------- */

/** How long a sign-in lasts between the sign-in page and the callback. */
const OAUTH_STATE_TTL_MS = 10 * 60_000;

/**
 * How Persuna identifies itself to an MCP server's sign-in provider: a
 * pre-registered client (per-vendor ids come from env in the callback
 * route), a Client ID Metadata Document URL used as the client id, or
 * nothing, in which case the provider registers Persuna on the spot.
 */
export interface McpOAuthClientConfig {
  clientId?: string;
  clientSecret?: string;
  cimdUrl?: string;
}

export { MCP_VENDORS, MCP_VENDOR_NAMES, isMcpVendor, type McpVendor } from "./auth";

/** The pre-registered OAuth client for a vendor, or null when unset. */
export function mcpVendorClient(vendor: McpVendor): {
  clientId: string;
  clientSecret?: string;
} | null {
  const e = env();
  const pair = {
    slack: [e.SLACK_MCP_CLIENT_ID, e.SLACK_MCP_CLIENT_SECRET],
    asana: [e.ASANA_MCP_CLIENT_ID, e.ASANA_MCP_CLIENT_SECRET],
    zoom: [e.ZOOM_MCP_CLIENT_ID, e.ZOOM_MCP_CLIENT_SECRET],
    x: [e.X_MCP_CLIENT_ID, e.X_MCP_CLIENT_SECRET],
    github: [e.GITHUB_MCP_CLIENT_ID, e.GITHUB_MCP_CLIENT_SECRET],
  }[vendor];
  if (!pair[0]) return null;
  return { clientId: pair[0], ...(pair[1] && { clientSecret: pair[1] }) };
}

/** Where providers send the browser after sign-in; same derivation at start and callback. */
export function mcpOAuthRedirectUri(origin: string): string {
  return `${(env().APP_URL ?? origin).replace(/\/+$/, "")}/api/mcp/oauth/callback`;
}

/** Persuna's Client ID Metadata Document, used as the client id by default. */
export function mcpCimdUrl(origin: string): string {
  return `${(env().APP_URL ?? origin).replace(/\/+$/, "")}/api/mcp/client-metadata`;
}

/** The cookie holding the OAuth secret half between start and callback. */
export const MCP_OAUTH_COOKIE = "persuna_mcp_oauth";

export interface McpOAuthBegin {
  /** The sign-in page URL to send the browser to. */
  url: string;
  /** Signed public state for the callback URL. */
  state: string;
  /** Secret half (PKCE verifier + client secret) for an httpOnly cookie. */
  secret: string;
}

/** The signed half of a sign-in in flight: public facts only, no secrets. */
interface OAuthState {
  u: string;
  name: string;
  url: string;
  scope: string;
  issuer: string;
  tokenEndpoint: string;
  clientId: string;
}

/**
 * Starts OAuth for an MCP server: discovers its sign-in provider, resolves
 * the client, and returns the sign-in page URL with a signed state. Nothing
 * is stored until the callback completes.
 */
export async function beginMcpOAuth(
  userId: string,
  input: {
    name: string;
    url: string;
    scope?: string;
    redirectUri: string;
    client?: McpOAuthClientConfig;
    wwwAuthenticate?: string | null;
  },
  actor: Actor,
  fetchFn?: typeof fetch,
): Promise<McpOAuthBegin> {
  const key = requireKey();
  const name = input.name.trim();
  if (!name) throw new Error("Give the server a name.");
  const url = checkedServerUrl(input.url);
  const scope = input.scope?.trim() ?? "";
  const { authServer } = await discoverAuthServer(url, input.wwwAuthenticate ?? null, fetchFn);
  let clientId = input.client?.clientId?.trim() || "";
  let clientSecret = input.client?.clientSecret?.trim() || "";
  if (!clientId && input.client?.cimdUrl?.trim()) {
    clientId = input.client.cimdUrl.trim();
  }
  if (!clientId) {
    const registered = await registerClientDynamic(
      authServer,
      { redirectUris: [input.redirectUri], clientName: "Persuna" },
      fetchFn,
    );
    clientId = registered.clientId;
    clientSecret = registered.clientSecret ?? "";
  }
  const pkce = createPkcePair();
  const state = signToken(
    {
      u: userId,
      name,
      url,
      scope,
      issuer: authServer.issuer,
      tokenEndpoint: authServer.tokenEndpoint,
      clientId,
    } satisfies OAuthState,
    key,
    Date.now() + OAUTH_STATE_TTL_MS,
  );
  await audit({
    actor,
    action: "mcp.oauth_started",
    entityType: "mcp_server",
    details: { name, issuer: authServer.issuer },
  });
  return {
    url: authorizationUrl({
      authServer,
      clientId,
      redirectUri: input.redirectUri,
      resource: url,
      ...(scope && { scope }),
      state,
      codeChallenge: pkce.challenge,
    }),
    state,
    secret: `${pkce.verifier}.${clientSecret}`,
  };
}

/**
 * Finishes OAuth: checks the state and secret, trades the code for tokens,
 * and stores the server with its credentials sealed. Replaces any
 * token-auth entry for the same address.
 */
export async function completeMcpOAuth(
  userId: string,
  input: { state: string; secret: string; code: string; redirectUri: string },
  actor: Actor,
  fetchFn?: typeof fetch,
): Promise<McpServerView> {
  const key = requireKey();
  const state = readToken<OAuthState>(input.state, key);
  if (!state || state.u !== userId) {
    throw new Error("That sign-in expired or wasn't started here. Try connecting again.");
  }
  const dot = input.secret.indexOf(".");
  if (dot <= 0) {
    throw new Error("That sign-in expired or wasn't started here. Try connecting again.");
  }
  const verifier = input.secret.slice(0, dot);
  const clientSecret = input.secret.slice(dot + 1) || undefined;
  const tokens = await exchangeCode(
    {
      authServer: { issuer: state.issuer, tokenEndpoint: state.tokenEndpoint },
      resource: state.url,
      clientId: state.clientId,
      ...(clientSecret && { clientSecret }),
      code: input.code,
      redirectUri: input.redirectUri,
      codeVerifier: verifier,
    },
    fetchFn,
  );
  const probe = new McpClient(state.url, tokens.accessToken, fetchFn);
  const tools = await probe.listTools();
  const oauth: McpOAuthCredentials = {
    issuer: tokens.issuer,
    resource: tokens.resource,
    tokenEndpoint: state.tokenEndpoint,
    clientId: state.clientId,
    clientSecret: clientSecret ? seal(clientSecret, key) : null,
    accessToken: seal(tokens.accessToken, key),
    refreshToken: tokens.refreshToken ? seal(tokens.refreshToken, key) : null,
    expiresAt: tokens.expiresAt,
    scope: tokens.scope,
  };
  const cached = tools.map((t) => ({ name: t.name, description: t.description.slice(0, 500) }));
  const [row] = await db()
    .insert(mcpServers)
    .values({
      userId,
      name: state.name,
      url: state.url,
      token: "",
      authType: "oauth",
      oauth,
      tools: cached,
    })
    .onConflictDoUpdate({
      target: [mcpServers.userId, mcpServers.url],
      set: {
        name: state.name,
        token: "",
        authType: "oauth",
        oauth,
        tools: cached,
        updatedAt: new Date(),
      },
    })
    .returning();
  await audit({
    actor,
    action: "mcp.oauth_connected",
    entityType: "mcp_server",
    entityId: row.id,
    details: { name: state.name, tools: tools.length },
  });
  return view(row);
}

/**
 * A working access token for a connected server: the fixed token, or the
 * OAuth token, refreshed without asking when it expired. OAuth tokens are
 * checked against the server they were requested for and never sent elsewhere.
 */
async function serverAccessToken(row: McpServer, fetchFn?: typeof fetch): Promise<string> {
  const key = requireKey();
  if (row.authType !== "oauth" || !row.oauth) {
    return row.token ? unseal(row.token, key) : "";
  }
  const creds = row.oauth;
  if (!tokenUsableFor(creds, row.url)) {
    throw new Error("Those sign-in details belong to another server. Reconnect it to continue.");
  }
  if (!creds.expiresAt || creds.expiresAt > Date.now()) {
    return unseal(creds.accessToken, key);
  }
  if (!creds.refreshToken) {
    throw new Error("That sign-in expired. Reconnect the server to continue.");
  }
  const fresh = await refreshAccessToken(
    {
      authServer: { issuer: creds.issuer, tokenEndpoint: creds.tokenEndpoint },
      resource: creds.resource,
      clientId: creds.clientId,
      ...(creds.clientSecret && { clientSecret: unseal(creds.clientSecret, key) }),
      refreshToken: unseal(creds.refreshToken, key),
      ...(creds.scope && { scope: creds.scope }),
    },
    fetchFn,
  );
  const next: McpOAuthCredentials = {
    ...creds,
    accessToken: seal(fresh.accessToken, key),
    refreshToken: fresh.refreshToken ? seal(fresh.refreshToken, key) : creds.refreshToken,
    expiresAt: fresh.expiresAt,
    scope: fresh.scope ?? creds.scope,
  };
  await db()
    .update(mcpServers)
    .set({ oauth: next, updatedAt: new Date() })
    .where(eq(mcpServers.id, row.id));
  await audit({
    actor: "system",
    action: "mcp.oauth_refreshed",
    entityType: "mcp_server",
    entityId: row.id,
    details: { name: row.name },
  });
  return fresh.accessToken;
}

/* ---------- Ask-before-acting, mirroring connected apps ---------- */

export interface McpConfirm {
  /** Signed: who, which server and tool, what arguments, until when. */
  token: string;
  preview: string;
  server: string;
  tool: string;
}

/** Proposes a tool call. Nothing runs until the user approves the token. */
export function proposeMcpCall(
  userId: string,
  server: McpServerView,
  tool: string,
  args: Record<string, unknown>,
): McpConfirm {
  const token = signToken(
    { u: userId, s: server.id, t: tool, a: args },
    requireKey(),
    Date.now() + CONFIRM_TTL_MS,
  );
  const argText = JSON.stringify(args);
  return {
    token,
    server: server.name,
    tool,
    preview: `Run ${tool} on ${server.name} with ${argText.length > 300 ? `${argText.slice(0, 300)}…` : argText}?`,
  };
}

const usedConfirmations = new Set<string>();

/** The user said yes: run the proposed call once, with the stored token. */
export async function confirmMcpCall(
  userId: string,
  token: string,
  actor: Actor,
  fetchFn?: typeof fetch,
): Promise<{ message: string; output: string }> {
  const pending = readToken<{ u: string; s: string; t: string; a: Record<string, unknown> }>(
    token,
    requireKey(),
  );
  if (!pending || pending.u !== userId) throw new Error("That request expired. Ask me again?");
  if (usedConfirmations.has(token)) throw new Error("That's already done.");
  usedConfirmations.add(token);
  const row = await serverRow(userId, pending.s);
  const result = await (await clientFor(row, fetchFn)).callTool(pending.t, pending.a ?? {});
  await audit({
    actor,
    action: "mcp.call",
    entityType: "mcp_server",
    entityId: row.id,
    details: { server: row.name, tool: pending.t, isError: result.isError },
  });
  if (result.isError)
    throw new Error(`${row.name} reported an error: ${result.text.slice(0, 300)}`);
  return { message: `Done — ${pending.t} on ${row.name}.`, output: result.text };
}
