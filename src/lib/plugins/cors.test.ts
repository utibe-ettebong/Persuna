import { describe, expect, it } from "vitest";
import { allowedPluginOrigin, pluginCorsHeaders } from "./cors";

process.env.DATABASE_URL ??= "postgres://localhost:5432/persuna_test";

describe("allowedPluginOrigin", () => {
  it("allows the Figma opaque origin", () => {
    expect(allowedPluginOrigin("null")).toBe("null");
  });

  it("reflects a listed origin", () => {
    process.env.PLUGIN_ORIGINS = "https://app-abc.canva-apps.com, chrome-extension://xyz";
    expect(allowedPluginOrigin("https://app-abc.canva-apps.com")).toBe(
      "https://app-abc.canva-apps.com",
    );
    delete process.env.PLUGIN_ORIGINS;
  });

  it("rejects unlisted and missing origins", () => {
    process.env.PLUGIN_ORIGINS = "https://app-abc.canva-apps.com";
    expect(allowedPluginOrigin("https://evil.example.com")).toBeNull();
    expect(allowedPluginOrigin(null)).toBeNull();
    delete process.env.PLUGIN_ORIGINS;
  });
});

describe("pluginCorsHeaders", () => {
  it("sets preflight headers for an allowed origin", () => {
    const headers = pluginCorsHeaders("null");
    expect(headers["Access-Control-Allow-Origin"]).toBe("null");
    expect(headers["Access-Control-Allow-Methods"]).toContain("POST");
  });

  it("sets nothing for a rejected origin", () => {
    expect(pluginCorsHeaders("https://evil.example.com")).toEqual({});
  });
});
