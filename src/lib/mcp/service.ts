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
import { mcpServers, type McpServer, type McpToolInfo } from "@/db/schema";
import { audit, type Actor } from "@/lib/audit";
import { connectionsKey } from "@/lib/connections/service";
import { readToken, seal, signToken, unseal } from "@/lib/connections/crypto";
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
  tools: McpToolInfo[];
}

function view(row: McpServer): McpServerView {
  return { id: row.id, name: row.name, url: row.url, tools: row.tools ?? [] };
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

function clientFor(row: McpServer, fetchFn?: typeof fetch): McpClient {
  const token = row.token ? unseal(row.token, requireKey()) : "";
  return new McpClient(row.url, token, fetchFn);
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
  const url = input.url.trim();
  if (!name) throw new Error("Give the server a name.");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("That server address is not a valid URL.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("MCP servers are connected by http(s) URL in this version.");
  }
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
      tools: tools.map((t) => ({ name: t.name, description: t.description.slice(0, 500) })),
    })
    .onConflictDoUpdate({
      target: [mcpServers.userId, mcpServers.url],
      set: {
        name,
        token: sealed,
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

/** Re-runs tool discovery for a connected server and caches the result. */
export async function refreshMcpTools(userId: string, serverId: string, fetchFn?: typeof fetch) {
  const row = await serverRow(userId, serverId);
  const tools = await clientFor(row, fetchFn).listTools();
  const cached = tools.map((t) => ({ name: t.name, description: t.description.slice(0, 500) }));
  await db()
    .update(mcpServers)
    .set({ tools: cached, updatedAt: new Date() })
    .where(eq(mcpServers.id, row.id));
  return cached;
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
  const result = await clientFor(row, fetchFn).callTool(pending.t, pending.a ?? {});
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
