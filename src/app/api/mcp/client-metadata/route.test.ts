import { describe, expect, it } from "vitest";
import { GET } from "./route";

process.env.DATABASE_URL ??= "postgres://localhost:5432/persuna_test";
process.env.APP_URL = "https://app.example.com";

describe("GET /api/mcp/client-metadata", () => {
  it("serves Persuna's client metadata with the callback redirect", async () => {
    const res = await GET(new Request("http://test/api/mcp/client-metadata"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      redirect_uris: ["https://app.example.com/api/mcp/oauth/callback"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: "Persuna",
      client_uri: "https://app.example.com",
      application_type: "web",
    });
  });
});
