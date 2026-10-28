import { describe, expect, it } from "vitest";
import { authorizeUrl, exchangeCode } from "./providers";

describe("authorizeUrl", () => {
  it("asks Google for Gmail and Calendar, offline, with our state", () => {
    const url = new URL(
      authorizeUrl("google", { clientId: "cid", redirectUri: "https://app/cb", state: "s1" }),
    );
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("state")).toBe("s1");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("scope")).toContain("gmail.compose");
    expect(url.searchParams.get("scope")).toContain("calendar.events");
  });

  it("asks Notion for a user-owned connection", () => {
    const url = new URL(
      authorizeUrl("notion", { clientId: "cid", redirectUri: "https://app/cb", state: "s" }),
    );
    expect(url.searchParams.get("owner")).toBe("user");
    expect(url.searchParams.has("scope")).toBe(false);
  });
});

describe("exchangeCode", () => {
  it("gets Google tokens and the account's email", async () => {
    const calls: string[] = [];
    const fake = (async (url: string) => {
      calls.push(url);
      return Response.json(
        url.includes("token")
          ? { access_token: "at", refresh_token: "rt", expires_in: 3600, scope: "email" }
          : { email: "ada@example.org" },
      );
    }) as unknown as typeof fetch;
    const tokens = await exchangeCode(
      "google",
      { code: "c", redirectUri: "r", clientId: "i", clientSecret: "s" },
      fake,
    );
    expect(tokens).toMatchObject({
      accessToken: "at",
      refreshToken: "rt",
      account: "ada@example.org",
    });
    expect(tokens.expiresAt!.getTime()).toBeGreaterThan(Date.now());
    expect(calls).toHaveLength(2);
  });

  it("names the Notion workspace", async () => {
    const fake = (async (_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).authorization).toMatch(/^Basic /);
      return Response.json({ access_token: "nt", workspace_name: "Acme wiki" });
    }) as unknown as typeof fetch;
    const tokens = await exchangeCode(
      "notion",
      { code: "c", redirectUri: "r", clientId: "i", clientSecret: "s" },
      fake,
    );
    expect(tokens).toMatchObject({ accessToken: "nt", account: "Acme wiki", refreshToken: null });
  });
});
