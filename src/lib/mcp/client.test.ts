import { describe, expect, it, vi } from "vitest";
import { McpClient, parseSseMessages } from "./client";

/** A fake streamable-HTTP MCP server behind a fetch-shaped function. */
function fakeServer() {
  const calls: { method: string; headers: Record<string, string> }[] = [];
  const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as {
      id?: number;
      method: string;
      params?: { name?: string };
    };
    calls.push({ method: body.method, headers: init.headers as Record<string, string> });
    const json = (payload: unknown, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json", ...headers },
      });
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (body.method === "initialize") {
      return json(
        { jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-03-26" } },
        { "mcp-session-id": "sess-1" },
      );
    }
    if (body.method === "tools/list") {
      return json({
        jsonrpc: "2.0",
        id: body.id,
        result: { tools: [{ name: "list_issues", description: "List issues" }] },
      });
    }
    if (body.method === "tools/call") {
      return json({
        jsonrpc: "2.0",
        id: body.id,
        result: { content: [{ type: "text", text: `called ${body.params?.name}` }] },
      });
    }
    return json({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "unknown" } });
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, calls };
}

describe("McpClient", () => {
  it("connects, lists tools, and echoes the session id", async () => {
    const { fetchFn, calls } = fakeServer();
    const client = new McpClient("https://mcp.example.com", "tok", fetchFn);
    const tools = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["list_issues"]);
    expect(calls.map((c) => c.method)).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list",
    ]);
    const listCall = calls.find((c) => c.method === "tools/list");
    expect(listCall?.headers["mcp-session-id"]).toBe("sess-1");
    expect(listCall?.headers.authorization).toBe("Bearer tok");
  });

  it("calls a tool and returns its text", async () => {
    const { fetchFn } = fakeServer();
    const client = new McpClient("https://mcp.example.com", "", fetchFn);
    const result = await client.callTool("list_issues", { state: "open" });
    expect(result).toEqual({ text: "called list_issues", isError: false });
  });

  it("surfaces JSON-RPC errors", async () => {
    const { fetchFn } = fakeServer();
    const client = new McpClient("https://mcp.example.com", "", fetchFn);
    await expect(
      // @ts-expect-error reaching past the typed surface to hit an unknown method
      client.request("bogus", {}),
    ).rejects.toThrow(/MCP error -32601/);
  });
});

describe("parseSseMessages", () => {
  it("extracts data lines and skips junk", () => {
    const body = [
      "event: message",
      'data: {"jsonrpc":"2.0","id":1,"result":{}}',
      "",
      "data: not-json",
      'data: {"jsonrpc":"2.0","id":2,"result":{}}',
    ].join("\n");
    expect(parseSseMessages(body).map((m) => m.id)).toEqual([1, 2]);
  });
});
