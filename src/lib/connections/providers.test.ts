import { describe, expect, it } from "vitest";
import { authorizeUrl, createPkce, exchangeCode, refreshAccess } from "./providers";

describe("authorizeUrl", () => {
  it("asks Google for Gmail, Calendar, Drive and Sheets, offline, with our state", () => {
    const url = new URL(
      authorizeUrl("google", { clientId: "cid", redirectUri: "https://app/cb", state: "s1" }),
    );
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("state")).toBe("s1");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("scope")).toContain("gmail.compose");
    expect(url.searchParams.get("scope")).toContain("calendar.events");
    expect(url.searchParams.get("scope")).toContain("drive.readonly");
    expect(url.searchParams.get("scope")).toContain("/spreadsheets");
  });

  it("asks Google for Drive file access too", () => {
    const url = new URL(
      authorizeUrl("google", { clientId: "cid", redirectUri: "https://app/cb", state: "s1" }),
    );
    expect(url.searchParams.get("scope")).toContain("drive.file");
  });

  it("asks Microsoft (multi-tenant) for sign-in and OneDrive files", () => {
    const url = new URL(
      authorizeUrl("microsoft", { clientId: "cid", redirectUri: "https://app/cb", state: "s" }),
    );
    expect(url.origin).toBe("https://login.microsoftonline.com");
    expect(url.pathname).toContain("/common/oauth2/v2/authorize");
    expect(url.searchParams.get("response_mode")).toBe("query");
    expect(url.searchParams.get("scope")).toContain("Files.ReadWrite");
    expect(url.searchParams.get("scope")).toContain("offline_access");
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

  it("asks X with PKCE and space-separated scopes", () => {
    const { challenge } = createPkce();
    const url = new URL(
      authorizeUrl("x", {
        clientId: "cid",
        redirectUri: "https://app/cb",
        state: "s",
        codeChallenge: challenge,
      }),
    );
    expect(url.origin).toBe("https://x.com");
    expect(url.searchParams.get("scope")).toBe("tweet.read tweet.write users.read offline.access");
    expect(url.searchParams.get("code_challenge")).toBe(challenge);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("makes PKCE verifiers the right shape", () => {
    const { verifier, challenge } = createPkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).not.toBe(verifier);
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

  it("trades a Microsoft code, naming the account from its id_token", async () => {
    const idToken = [
      Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
      Buffer.from(JSON.stringify({ email: "ada@outlook.com" })).toString("base64url"),
      "sig",
    ].join(".");
    const fake = (async (url: string, init?: RequestInit) => {
      expect(String(url)).toContain("/common/oauth2/v2/token");
      expect(new URLSearchParams(String(init?.body)).get("grant_type")).toBe("authorization_code");
      return Response.json({
        access_token: "ms-at",
        refresh_token: "ms-rt",
        expires_in: 3600,
        id_token: idToken,
      });
    }) as unknown as typeof fetch;
    const tokens = await exchangeCode(
      "microsoft",
      { code: "c", redirectUri: "r", clientId: "i", clientSecret: "s" },
      fake,
    );
    expect(tokens).toMatchObject({
      accessToken: "ms-at",
      refreshToken: "ms-rt",
      account: "ada@outlook.com",
    });
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
  it("refreshes a Microsoft token like Google's", async () => {
    const fake = (async (url: string, init?: RequestInit) => {
      expect(String(url)).toContain("/common/oauth2/v2/token");
      expect(new URLSearchParams(String(init?.body)).get("grant_type")).toBe("refresh_token");
      return Response.json({ access_token: "ms-new", refresh_token: "ms-rt2", expires_in: 3600 });
    }) as unknown as typeof fetch;
    const fresh = await refreshAccess(
      "microsoft",
      "ms-rt",
      { clientId: "i", clientSecret: "s" },
      fake,
    );
    expect(fresh).toMatchObject({ accessToken: "ms-new", refreshToken: "ms-rt2" });
    expect(fresh.expiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

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

  it("trades an X code and verifier for tokens and the handle", async () => {
    const fake = (async (url: string, init?: RequestInit) => {
      if (url.endsWith("/users/me")) {
        expect((init?.headers as Record<string, string>).authorization).toBe("Bearer x-access");
        return Response.json({ data: { id: "u1", username: "adabakes" } });
      }
      const body = new URLSearchParams(String(init?.body ?? ""));
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("code_verifier")).toBe("the-verifier");
      expect((init?.headers as Record<string, string>).authorization).toMatch(/^Basic /);
      return Response.json({
        access_token: "x-access",
        refresh_token: "x-refresh",
        expires_in: 7200,
      });
    }) as unknown as typeof fetch;
    const tokens = await exchangeCode(
      "x",
      {
        code: "c",
        redirectUri: "r",
        clientId: "i",
        clientSecret: "s",
        codeVerifier: "the-verifier",
      },
      fake,
    );
    expect(tokens).toMatchObject({
      accessToken: "x-access",
      refreshToken: "x-refresh",
      account: "@adabakes",
    });
  });

  it("refuses an X code without its verifier", async () => {
    await expect(
      exchangeCode("x", { code: "c", redirectUri: "r", clientId: "i", clientSecret: "s" }),
    ).rejects.toThrow("PKCE verifier");
  });

  it("rotates X refresh tokens", async () => {
    const fake = (async (url: string, init?: RequestInit) => {
      expect(url).toContain("/oauth2/token");
      const body = new URLSearchParams(String(init?.body ?? ""));
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("refresh_token")).toBe("old-refresh");
      return Response.json({
        access_token: "x-access-2",
        refresh_token: "x-refresh-2",
        expires_in: 7200,
      });
    }) as unknown as typeof fetch;
    const fresh = await refreshAccess(
      "x",
      "old-refresh",
      { clientId: "i", clientSecret: "s" },
      fake,
    );
    expect(fresh).toMatchObject({ accessToken: "x-access-2", refreshToken: "x-refresh-2" });
    expect(fresh.expiresAt!.getTime()).toBeGreaterThan(Date.now());
  });
});
