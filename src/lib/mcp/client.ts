/**
 * Minimal MCP client for remote streamable-HTTP servers: initialize,
 * tools/list, tools/call. No stdio/local servers in v1. Transport takes an
 * injected fetch so tests drive it against a fake server. Responses may be
 * plain JSON or an SSE stream; a session id, when the server issues one, is
 * echoed back on later requests.
 */
export interface McpTool {
  name: string;
  description: string;
  inputSchema?: unknown;
}

export interface McpCallResult {
  text: string;
  isError: boolean;
}

type FetchFn = typeof fetch;

const PROTOCOL_VERSION = "2025-03-26";
const REQUEST_TIMEOUT_MS = 30_000;

interface JsonRpcResponse {
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

/** Pulls JSON-RPC messages out of an SSE body (`data:` lines). */
export function parseSseMessages(body: string): JsonRpcResponse[] {
  const out: JsonRpcResponse[] = [];
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      out.push(JSON.parse(payload) as JsonRpcResponse);
    } catch {
      // Not JSON: not a JSON-RPC message.
    }
  }
  return out;
}

export class McpClient {
  private nextId = 1;
  private sessionId: string | null = null;
  private initialized = false;

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  private async send(message: Record<string, unknown>): Promise<JsonRpcResponse | null> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
    const res = await this.fetchFn(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const issued = res.headers.get("mcp-session-id");
    if (issued) this.sessionId = issued;
    if (res.status === 202 || res.status === 204) return null;
    const body = await res.text();
    if (!res.ok) throw new Error(`MCP server answered ${res.status}: ${body.slice(0, 200)}`);
    if (!body.trim()) return null;
    const contentType = res.headers.get("content-type") ?? "";
    const messages = contentType.includes("text/event-stream")
      ? parseSseMessages(body)
      : [JSON.parse(body) as JsonRpcResponse];
    const id = message.id as number | undefined;
    const match = messages.find((m) => m.id === id) ?? messages.at(-1);
    if (!match) throw new Error("MCP server sent no answer");
    if (match.error) throw new Error(`MCP error ${match.error.code}: ${match.error.message}`);
    return match;
  }

  private async request<T>(method: string, params?: unknown): Promise<T> {
    const res = await this.send({ jsonrpc: "2.0", id: this.nextId++, method, params });
    if (!res) throw new Error(`MCP server gave no result for ${method}`);
    return res.result as T;
  }

  /** initialize + notifications/initialized, once per client. */
  async connect(): Promise<void> {
    if (this.initialized) return;
    await this.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "persuna", version: "1.0.0" },
    });
    await this.send({ jsonrpc: "2.0", method: "notifications/initialized" }).catch(() => null);
    this.initialized = true;
  }

  async listTools(): Promise<McpTool[]> {
    await this.connect();
    const result = await this.request<{ tools?: McpTool[] }>("tools/list");
    return (result.tools ?? []).map((t) => ({
      name: String(t.name),
      description: String(t.description ?? ""),
      inputSchema: t.inputSchema,
    }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    await this.connect();
    const result = await this.request<{
      content?: { type: string; text?: string }[];
      isError?: boolean;
    }>("tools/call", { name, arguments: args });
    const text = (result.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n");
    return { text: text || "(no output)", isError: Boolean(result.isError) };
  }
}
