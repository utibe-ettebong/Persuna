import { describe, expect, it } from "vitest";
import { authorizeUrl, exchangeCode, refreshAccess } from "./providers";

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

  it("asks Meta for page and Instagram permissions, comma-separated", () => {
    const url = new URL(
      authorizeUrl("meta", { clientId: "cid", redirectUri: "https://app/cb", state: "s" }),
    );
    expect(url.origin).toBe("https://www.facebook.com");
    expect(url.pathname).toContain("/dialog/oauth");
    expect(url.searchParams.get("scope")).toBe(
      "pages_show_list,pages_read_engagement,pages_manage_posts,instagram_business_basic",
    );
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

  it("trades a Meta code for a long-lived token and the account name", async () => {
    const calls: string[] = [];
    const fake = (async (url: string) => {
      calls.push(url);
      if (url.includes("/me?")) return Response.json({ name: "Ada Lovelace" });
      if (url.includes("fb_exchange_token")) {
        return Response.json({ access_token: "long-lived", expires_in: 5184000 });
      }
      return Response.json({ access_token: "short-lived", expires_in: 3600 });
    }) as unknown as typeof fetch;
    const tokens = await exchangeCode(
      "meta",
      { code: "c", redirectUri: "r", clientId: "i", clientSecret: "s" },
      fake,
    );
    expect(tokens).toMatchObject({
      accessToken: "long-lived",
      refreshToken: "long-lived",
      account: "Ada Lovelace",
    });
    expect(tokens.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 30 * 86_400_000);
    expect(tokens.scopes).toContain("pages_manage_posts");
    expect(calls).toHaveLength(3);
  });
});

describe("refreshAccess", () => {
  it("extends a live Meta token by re-exchanging it", async () => {
    const fake = (async (url: string) => {
      expect(url).toContain("grant_type=fb_exchange_token");
      expect(url).toContain("fb_exchange_token=old-long");
      return Response.json({ access_token: "new-long", expires_in: 5184000 });
    }) as unknown as typeof fetch;
    const fresh = await refreshAccess(
      "meta",
      "old-long",
      { clientId: "i", clientSecret: "s" },
      fake,
    );
    expect(fresh).toMatchObject({ accessToken: "new-long", refreshToken: "new-long" });
    expect(fresh.expiresAt!.getTime()).toBeGreaterThan(Date.now());
  });
});
