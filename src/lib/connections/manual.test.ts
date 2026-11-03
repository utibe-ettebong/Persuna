import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { audit } from "@/lib/audit";
import { connectManualToken, connectionAccountFor } from "./service";

process.env.DATABASE_URL ??= "postgres://localhost:5432/persuna_test";
process.env.CONNECTIONS_KEY ??= "test-connections-key-0123456789abcdef";

vi.mock("@/db/client", async (original) => ({
  ...(await original<typeof import("@/db/client")>()),
  db: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

function stubDb(rows: { account?: string | null } | null) {
  const writes: { values: unknown; set: unknown }[] = [];
  const tx = {
    insert: () => ({
      values: (values: unknown) => {
        writes.push({ values, set: null });
        return {
          onConflictDoUpdate: ({ set }: { set: unknown }) => {
            writes.push({ values: null, set });
            return { returning: async () => [{ id: "conn-1" }] };
          },
        };
      },
    }),
  };
  vi.mocked(db).mockReturnValue({
    query: { appConnections: { findFirst: async () => rows } },
    transaction: async (work: (t: unknown) => Promise<unknown>) => work(tx),
  } as never);
  return { writes };
}

beforeEach(() => vi.clearAllMocks());

describe("connectManualToken", () => {
  it("verifies the Shopify token, then stores it sealed", async () => {
    const { writes } = stubDb(null);
    const seen: string[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      seen.push(String(url));
      expect((init?.headers as Record<string, string>)["X-Shopify-Access-Token"]).toBe("shpat-x");
      return Response.json({ shop: { name: "Acme" } });
    }) as unknown as typeof fetch;
    const { account } = await connectManualToken(
      "user-1",
      "shopify",
      { account: "Acme", token: "shpat-x", actor: "user:a@b.c" },
      fetchFn,
    );
    expect(account).toBe("acme.myshopify.com");
    expect(seen[0]).toBe("https://acme.myshopify.com/admin/api/2026-07/shop.json");
    const stored = writes[0].values as Record<string, unknown>;
    expect(stored.account).toBe("acme.myshopify.com");
    expect(stored.refreshToken).toBeNull();
    expect(stored.accessToken).not.toBe("shpat-x");
    const [first] = vi.mocked(audit).mock.calls;
    expect(first?.[0]).toMatchObject({
      action: "connection.added",
      details: { provider: "shopify" },
    });
  });

  it("verifies a Mailchimp key against its own server", async () => {
    stubDb(null);
    const seen: string[] = [];
    const fetchFn = (async (url: string) => {
      seen.push(String(url));
      return Response.json({ account_name: "Acme" });
    }) as unknown as typeof fetch;
    const { account } = await connectManualToken(
      "user-1",
      "mailchimp",
      { account: "Acme news", token: "abc123-us21", actor: "user:a@b.c" },
      fetchFn,
    );
    expect(account).toBe("Acme news");
    expect(seen[0]).toBe("https://us21.api.mailchimp.com/3.0/");
  });

  it("rejects bad tokens and OAuth providers", async () => {
    stubDb(null);
    const bad = (async () => new Response("no", { status: 401 })) as unknown as typeof fetch;
    await expect(
      connectManualToken(
        "user-1",
        "shopify",
        { account: "acme", token: "bad", actor: "user:a@b.c" },
        bad,
      ),
    ).rejects.toThrow(/didn't work/);
    await expect(
      connectManualToken(
        "user-1",
        "google",
        { account: "x", token: "y", actor: "user:a@b.c" },
        bad,
      ),
    ).rejects.toThrow(/sign-in, not a token/);
  });
});

describe("connectionAccountFor", () => {
  it("returns the stored account or null", async () => {
    stubDb({ account: "acme.myshopify.com" });
    expect(await connectionAccountFor("user-1", "shopify")).toBe("acme.myshopify.com");
    stubDb(null);
    expect(await connectionAccountFor("user-1", "shopify")).toBeNull();
  });
});
