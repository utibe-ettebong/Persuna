import { describe, expect, it } from "vitest";
import { toolNamed, type ToolContext } from "./tools";

const PAGES = {
  data: [
    {
      id: "p1",
      name: "Ada Bakes",
      category: "Bakery",
      access_token: "page-token-1",
      instagram_business_account: { id: "ig1", username: "adabakes" },
    },
    { id: "p2", name: "Ada Reads", category: "Bookstore", access_token: "page-token-2" },
  ],
};

const ctx = (fetchImpl: typeof fetch): ToolContext => ({
  token: "user-token",
  offset: 60,
  fetch: fetchImpl,
});

const stub = (routes: Record<string, unknown>, seen: { url: string; auth: string }[] = []) =>
  (async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    seen.push({ url, auth: headers.authorization ?? "" });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) throw new Error(`unexpected call ${url}`);
    return Response.json(routes[key]);
  }) as unknown as typeof fetch;

describe("meta_list_pages", () => {
  it("names each page and its Instagram, never the tokens", async () => {
    const tool = toolNamed("meta_list_pages")!;
    const out = (await tool.run({}, ctx(stub({ "/me/accounts": PAGES })))) as unknown[];
    expect(out).toEqual([
      { name: "Ada Bakes", category: "Bakery", instagram: "adabakes" },
      { name: "Ada Reads", category: "Bookstore", instagram: null },
    ]);
    expect(JSON.stringify(out)).not.toContain("page-token");
  });
});

describe("facebook_list_posts", () => {
  it("finds the page by partial name and reads with its token", async () => {
    const seen: { url: string; auth: string }[] = [];
    const tool = toolNamed("facebook_list_posts")!;
    const out = (await tool.run(
      { page: "bakes", limit: 5 },
      ctx(
        stub(
          {
            "/me/accounts": PAGES,
            "/p1/posts": {
              data: [
                {
                  message: "Fresh sourdough today",
                  created_time: "2026-10-01T09:00:00+0000",
                  permalink_url: "https://fb.me/x",
                  likes: { summary: { total_count: 12 } },
                  comments: { summary: { total_count: 3 } },
                },
              ],
            },
          },
          seen,
        ),
      ),
    )) as { message: string; likes: number; comments: number }[];
    expect(out).toEqual([
      {
        message: "Fresh sourdough today",
        at: "2026-10-01T09:00:00+0000",
        url: "https://fb.me/x",
        likes: 12,
        comments: 3,
      },
    ]);
    expect(seen.find((s) => s.url.includes("/p1/posts"))?.auth).toBe("Bearer page-token-1");
  });

  it("says which pages exist when the name matches nothing", async () => {
    const tool = toolNamed("facebook_list_posts")!;
    await expect(
      tool.run({ page: "nope", limit: 5 }, ctx(stub({ "/me/accounts": PAGES }))),
    ).rejects.toThrow("Ada Bakes, Ada Reads");
  });
});

describe("instagram_list_media", () => {
  it("reads the linked account's recent media", async () => {
    const tool = toolNamed("instagram_list_media")!;
    const out = (await tool.run(
      { page: "Ada Bakes", limit: 5 },
      ctx(
        stub({
          "/me/accounts": PAGES,
          "/ig1/media": {
            data: [
              {
                caption: "Morning bake",
                timestamp: "2026-10-02T08:00:00+0000",
                permalink: "https://ig.me/y",
                like_count: 40,
                comments_count: 5,
              },
            ],
          },
        }),
      ),
    )) as unknown[];
    expect(out).toEqual([
      {
        caption: "Morning bake",
        at: "2026-10-02T08:00:00+0000",
        url: "https://ig.me/y",
        likes: 40,
        comments: 5,
      },
    ]);
  });

  it("explains how to link Instagram when there is none", async () => {
    const tool = toolNamed("instagram_list_media")!;
    await expect(
      tool.run({ page: "Ada Reads", limit: 5 }, ctx(stub({ "/me/accounts": PAGES }))),
    ).rejects.toThrow("no linked Instagram business account");
  });
});

describe("facebook_post", () => {
  it("posts with the page token and previews the exact words", async () => {
    const seen: { url: string; auth: string }[] = [];
    let body = "";
    const postFetch = (async (url: string, init?: RequestInit) => {
      seen.push({
        url,
        auth: ((init?.headers ?? {}) as Record<string, string>).authorization ?? "",
      });
      if (url.includes("/feed")) {
        body = String(init?.body ?? "");
        return Response.json({ id: "p1_post9" });
      }
      return Response.json(PAGES);
    }) as unknown as typeof fetch;
    const tool = toolNamed("facebook_post")!;
    expect(tool.writes).toBe(true);
    expect(tool.preview!({ page: "Ada Bakes", message: "Hello", link: null })).toContain("Hello");
    const out = await tool.run({ page: "Ada Bakes", message: "Hello", link: null }, ctx(postFetch));
    expect(out).toEqual({ posted: true, id: "p1_post9" });
    expect(seen.find((s) => s.url.includes("/feed"))?.auth).toBe("Bearer page-token-1");
    expect(JSON.parse(body)).toMatchObject({ message: "Hello" });
  });
});
