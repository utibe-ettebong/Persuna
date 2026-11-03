import { describe, expect, it, vi } from "vitest";
import { McpClient, parseSseMessages } from "./client";

/** A fake streamable-HTTP MCP server behind a fetch-shaped function. */
function fakeServer(options: { stateless?: boolean; initializeError?: number } = {}) {
  const calls: { method: string; headers: Record<string, string>; params: unknown }[] = [];
  const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as {
      id?: number;
      method: string;
      params?: { name?: string };
    };
    calls.push({
      method: body.method,
      headers: init.headers as Record<string, string>,
      params: body.params,
    });
    const json = (payload: unknown, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json", ...headers },
      });
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (body.method === "initialize") {
      if (options.initializeError) {
        return json({
          jsonrpc: "2.0",
          id: body.id,
          error: { code: options.initializeError, message: "Invalid request" },
        });
      }
      if (options.stateless) {
        return json({
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32601, message: "Method not found" },
        });
      }
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

  it("sends version and routing headers with self-describing requests", async () => {
    const { fetchFn, calls } = fakeServer();
    const client = new McpClient("https://mcp.example.com", "tok", fetchFn);
    await client.callTool("list_issues", { state: "open" });
    for (const call of calls) {
      expect(call.headers["MCP-Protocol-Version"]).toBe("2026-07-28");
      expect(call.headers["Mcp-Method"]).toBe(call.method);
    }
    const call = calls.find((c) => c.method === "tools/call")!;
    expect(call.headers["Mcp-Name"]).toBe("list_issues");
    expect(call.params).toMatchObject({
      name: "list_issues",
      _meta: { protocolVersion: "2026-07-28", clientInfo: { name: "persuna" } },
    });
  });

  it("works stateless when the server retired the handshake", async () => {
    const { fetchFn, calls } = fakeServer({ stateless: true });
    const client = new McpClient("https://mcp.example.com", "", fetchFn);
    const tools = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["list_issues"]);
    expect(calls.map((c) => c.method)).toEqual(["initialize", "tools/list"]);
  });

  it("still throws other handshake errors", async () => {
    const { fetchFn } = fakeServer({ initializeError: -32600 });
    const client = new McpClient("https://mcp.example.com", "", fetchFn);
    await expect(client.listTools()).rejects.toThrow(/MCP error -32600/);
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
