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

describe("x_list_posts", () => {
  it("maps recent posts with links and counts", async () => {
    const tool = toolNamed("x_list_posts")!;
    const out = (await tool.run(
      { limit: 10 },
      ctx(
        stub({
          "/users/me/tweets": {
            data: [
              {
                id: "t1",
                text: "Fresh sourdough today",
                created_at: "2026-10-01T09:00:00.000Z",
                public_metrics: { like_count: 12, retweet_count: 2, reply_count: 3 },
              },
            ],
          },
        }),
      ),
    )) as unknown[];
    expect(out).toEqual([
      {
        text: "Fresh sourdough today",
        at: "2026-10-01T09:00:00.000Z",
        url: "https://x.com/i/status/t1",
        likes: 12,
        reposts: 2,
        replies: 3,
      },
    ]);
  });
});

describe("x_list_mentions", () => {
  it("reads the mentions timeline", async () => {
    const seen: { url: string; auth: string }[] = [];
    const tool = toolNamed("x_list_mentions")!;
    const out = (await tool.run(
      { limit: 10 },
      ctx(stub({ "/users/me/mentions": { data: [] } }, seen)),
    )) as unknown[];
    expect(out).toEqual([]);
    expect(seen[0].url).toContain("tweet.fields=created_at,public_metrics");
    expect(seen[0].auth).toBe("Bearer user-token");
  });
});

describe("x_post", () => {
  it("posts the exact text and previews it first", async () => {
    let body = "";
    const postFetch = (async (url: string, init?: RequestInit) => {
      body = String(init?.body ?? "");
      expect(init?.method).toBe("POST");
      return Response.json({ data: { id: "t9", text: "Hello" } });
    }) as unknown as typeof fetch;
    const tool = toolNamed("x_post")!;
    expect(tool.writes).toBe(true);
    expect(tool.preview!({ text: "Hello" })).toContain("Hello");
    const out = await tool.run({ text: "Hello" }, ctx(postFetch));
    expect(out).toEqual({ posted: true, id: "t9" });
    expect(JSON.parse(body)).toEqual({ text: "Hello" });
  });
});

const DRIVE_FILES = {
  files: [
    {
      id: "doc1",
      name: "Client brief",
      mimeType: "application/vnd.google-apps.document",
      modifiedTime: "2026-10-01T09:00:00.000Z",
    },
    {
      id: "sheet1",
      name: "Invoice tracker",
      mimeType: "application/vnd.google-apps.spreadsheet",
      modifiedTime: "2026-10-02T09:00:00.000Z",
    },
  ],
};

describe("drive_list_files", () => {
  it("lists recent files with friendly kinds", async () => {
    const tool = toolNamed("drive_list_files")!;
    const out = (await tool.run(
      { query: "", limit: 5 },
      ctx(stub({ "/drive/v3/files?q=": DRIVE_FILES })),
    )) as unknown[];
    expect(out).toEqual([
      { name: "Client brief", kind: "doc", modified: "2026-10-01T09:00:00.000Z" },
      { name: "Invoice tracker", kind: "sheet", modified: "2026-10-02T09:00:00.000Z" },
    ]);
  });
});

describe("drive_read_file", () => {
  it("exports a Google Doc as text", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => {
      seen.push(url);
      if (url.includes("/export?")) return new Response("Brief contents here");
      return Response.json(DRIVE_FILES);
    }) as unknown as typeof fetch;
    const tool = toolNamed("drive_read_file")!;
    const out = await tool.run({ file: "Client brief" }, ctx(fetchImpl));
    expect(out).toEqual({ name: "Client brief", text: "Brief contents here", truncated: false });
    expect(seen.find((u) => u.includes("/export?"))).toContain("text%2Fplain");
  });

  it("refuses folders and oversized uploads", async () => {
    const fetchImpl = (async (url: string) => {
      if (url.includes("Folder")) {
        return Response.json({
          files: [{ id: "f1", name: "Folder", mimeType: "application/vnd.google-apps.folder" }],
        });
      }
      return Response.json({
        files: [{ id: "big1", name: "Video", mimeType: "video/mp4", size: "500000" }],
      });
    }) as unknown as typeof fetch;
    const tool = toolNamed("drive_read_file")!;
    await expect(tool.run({ file: "Folder" }, ctx(fetchImpl))).rejects.toThrow("is a folder");
    await expect(tool.run({ file: "Video" }, ctx(fetchImpl))).rejects.toThrow("too big");
  });
});

describe("sheets_read_range", () => {
  it("reads cells from the named spreadsheet", async () => {
    const fetchImpl = (async (url: string) => {
      if (url.includes("/values/")) {
        return Response.json({ range: "Sheet1!A1:B2", values: [["a", "b"], ["c"]] });
      }
      // The real search applies the spreadsheet filter; the stub answers the same way.
      return Response.json({ files: [DRIVE_FILES.files[1]] });
    }) as unknown as typeof fetch;
    const tool = toolNamed("sheets_read_range")!;
    const out = await tool.run(
      { spreadsheet: "Invoice tracker", range: "Sheet1!A1:B2" },
      ctx(fetchImpl),
    );
    expect(out).toEqual({
      name: "Invoice tracker",
      range: "Sheet1!A1:B2",
      rows: [["a", "b"], ["c"]],
    });
  });
});

describe("sheets_append_row", () => {
  it("appends the row and previews it first", async () => {
    let body = "";
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (url.includes(":append")) {
        body = String(init?.body ?? "");
        expect(init?.method).toBe("POST");
        return Response.json({});
      }
      return Response.json({ files: [DRIVE_FILES.files[1]] });
    }) as unknown as typeof fetch;
    const tool = toolNamed("sheets_append_row")!;
    expect(tool.writes).toBe(true);
    expect(
      tool.preview!({ spreadsheet: "Invoice tracker", range: "Sheet1!A:C", values: ["a", "b"] }),
    ).toContain("a | b");
    const out = await tool.run(
      { spreadsheet: "Invoice tracker", range: "Sheet1!A:C", values: ["a", "b"] },
      ctx(fetchImpl),
    );
    expect(out).toEqual({ added: true });
    expect(JSON.parse(body)).toEqual({ values: [["a", "b"]] });
  });
});

describe("drive_upload", () => {
  it("renders and uploads, returning the file link", async () => {
    let contentType = "";
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      expect(String(url)).toContain("upload/drive/v3/files?uploadType=multipart");
      expect(init?.method).toBe("POST");
      contentType = (init?.headers as Record<string, string>)["content-type"];
      return Response.json({ id: "f1", name: "Notes.docx", webViewLink: "https://drive/x/f1" });
    }) as unknown as typeof fetch;
    const tool = toolNamed("drive_upload")!;
    expect(tool.writes).toBe(true);
    expect(tool.preview!({ name: "Notes", format: "docx", text: "# Hi", convert: true })).toContain(
      "Notes.docx",
    );
    const out = await tool.run(
      { name: "Notes", format: "docx", text: "# Hi", convert: true },
      ctx(fetchImpl),
    );
    expect(out).toEqual({ saved: true, name: "Notes.docx", link: "https://drive/x/f1" });
    expect(contentType).toContain("multipart/related");
  });
});

describe("onedrive_upload", () => {
  it("PUTs the rendered file to the drive root", async () => {
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe(
        "https://graph.microsoft.com/v1.0/me/drive/root:/Notes.pdf:/content",
      );
      expect(init?.method).toBe("PUT");
      return Response.json({ id: "o1", name: "Notes.pdf", webUrl: "https://onedrive/x" });
    }) as unknown as typeof fetch;
    const tool = toolNamed("onedrive_upload")!;
    expect(tool.writes).toBe(true);
    const out = await tool.run({ name: "Notes", format: "pdf", text: "# Hi" }, ctx(fetchImpl));
    expect(out).toEqual({ saved: true, name: "Notes.pdf", link: "https://onedrive/x" });
  });
});

describe("docs_create", () => {
  it("creates the doc and adds opening text", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen.push(`${init?.method} ${url}`);
      if (String(url).endsWith("/documents")) return Response.json({ documentId: "d1" });
      return Response.json({});
    }) as unknown as typeof fetch;
    const tool = toolNamed("docs_create")!;
    const out = await tool.run({ title: "Notes", body: "Hello" }, ctx(fetchImpl));
    expect(out).toEqual({
      created: true,
      id: "d1",
      link: "https://docs.google.com/document/d/d1/edit",
    });
    expect(seen).toEqual([
      "POST https://docs.googleapis.com/v1/documents",
      "POST https://docs.googleapis.com/v1/documents/d1:batchUpdate",
    ]);
  });
});

describe("docs_append_text", () => {
  it("finds the doc by name and appends", async () => {
    const fetchImpl = (async (url: string) => {
      if (String(url).includes("drive/v3/files?q=")) {
        return Response.json({
          files: [{ id: "d1", name: "Notes", mimeType: "application/vnd.google-apps.document" }],
        });
      }
      return Response.json({});
    }) as unknown as typeof fetch;
    const out = await toolNamed("docs_append_text")!.run(
      { document: "Notes", text: "More" },
      ctx(fetchImpl),
    );
    expect(out).toEqual({ added: true, id: "d1", name: "Notes" });
  });
});

describe("sheets_create_spreadsheet", () => {
  it("creates the sheet and links it", async () => {
    const fetchImpl = stub({ spreadsheets: { spreadsheetId: "s1" } });
    const out = await toolNamed("sheets_create_spreadsheet")!.run(
      { title: "Budget" },
      ctx(fetchImpl),
    );
    expect(out).toEqual({
      created: true,
      id: "s1",
      link: "https://docs.google.com/spreadsheets/d/s1/edit",
    });
  });
});

describe("slides_create_presentation", () => {
  it("creates the deck and links it", async () => {
    const fetchImpl = stub({ presentations: { presentationId: "p1" } });
    const out = await toolNamed("slides_create_presentation")!.run(
      { title: "Deck" },
      ctx(fetchImpl),
    );
    expect(out).toEqual({
      created: true,
      id: "p1",
      link: "https://docs.google.com/presentation/d/p1/edit",
    });
  });
});

describe("onedrive_list_files", () => {
  it("names files and folders", async () => {
    const fetchImpl = stub({
      "/children": {
        value: [
          { name: "a.xlsx", file: {}, size: 10 },
          { name: "Docs", folder: {} },
        ],
      },
    });
    const out = await toolNamed("onedrive_list_files")!.run({ folder: "" }, ctx(fetchImpl));
    expect(out).toEqual([
      { name: "a.xlsx", folder: false, size: 10 },
      { name: "Docs", folder: true, size: null },
    ]);
  });
});

describe("excel_read_range", () => {
  it("resolves the file and reads the range", async () => {
    const fetchImpl = (async (url: string) => {
      if (String(url).includes("/search(")) {
        return Response.json({ value: [{ id: "f1", name: "Budget.xlsx", file: {} }] });
      }
      if (String(url).includes("/worksheets?")) {
        return Response.json({ value: [{ name: "Sheet1" }] });
      }
      return Response.json({
        values: [
          ["a", "b"],
          ["c", "d"],
        ],
      });
    }) as unknown as typeof fetch;
    const out = await toolNamed("excel_read_range")!.run(
      { file: "Budget.xlsx", worksheet: "", range: "A1:B2" },
      ctx(fetchImpl),
    );
    expect(out).toEqual({
      name: "Budget.xlsx",
      worksheet: "Sheet1",
      values: [
        ["a", "b"],
        ["c", "d"],
      ],
    });
  });
});

describe("excel_update_range", () => {
  it("PATCHes the values", async () => {
    let body = "";
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (String(url).includes("/worksheets?")) return Response.json({ value: [{ name: "S" }] });
      if (init?.method === "PATCH") {
        body = String(init.body);
        return Response.json({});
      }
      return Response.json({ value: [{ id: "f1", name: "B.xlsx", file: {} }] });
    }) as unknown as typeof fetch;
    const out = await toolNamed("excel_update_range")!.run(
      { file: "B.xlsx", worksheet: "", range: "A1:A1", values: [["x"]] },
      ctx(fetchImpl),
    );
    expect(out).toMatchObject({ updated: true });
    expect(JSON.parse(body)).toEqual({ values: [["x"]] });
  });
});

describe("outlook_list_messages", () => {
  it("trims mail to subject, sender and preview", async () => {
    const fetchImpl = stub({
      "/messages": {
        value: [
          {
            subject: "Hi",
            from: { emailAddress: { address: "a@b.c" } },
            receivedDateTime: "2026-11-01T10:00:00Z",
            bodyPreview: "Hello there",
          },
        ],
      },
    });
    const out = await toolNamed("outlook_list_messages")!.run(
      { folder: "inbox", top: 5 },
      ctx(fetchImpl),
    );
    expect(out).toEqual([
      { subject: "Hi", from: "a@b.c", at: "2026-11-01T10:00:00Z", preview: "Hello there" },
    ]);
  });
});

describe("outlook_send", () => {
  it("sends via sendMail", async () => {
    let body = "";
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      expect(String(url)).toContain("/me/sendMail");
      body = String(init?.body);
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;
    const out = await toolNamed("outlook_send")!.run(
      { to: "a@b.c", subject: "Hi", body: "Hello" },
      ctx(fetchImpl),
    );
    expect(out).toEqual({ sent: true });
    expect(JSON.parse(body).message.toRecipients).toEqual([{ emailAddress: { address: "a@b.c" } }]);
  });
});

describe("teams_post_message", () => {
  it("posts and returns the message id", async () => {
    const fetchImpl = stub({ "/messages": { id: "m1" } });
    const out = await toolNamed("teams_post_message")!.run(
      { team_id: "t1", channel_id: "c1", text: "Hello team" },
      ctx(fetchImpl),
    );
    expect(out).toEqual({ posted: true, id: "m1" });
  });
});

describe("teams_list", () => {
  it("names joined teams and their channels", async () => {
    const fetchImpl = stub({
      joinedTeams: { value: [{ id: "t1", displayName: "Eng" }] },
      "/channels": { value: [{ id: "c1", displayName: "General" }] },
    });
    expect(await toolNamed("teams_list")!.run({}, ctx(fetchImpl))).toEqual([
      { id: "t1", name: "Eng" },
    ]);
    expect(await toolNamed("teams_list_channels")!.run({ team_id: "t1" }, ctx(fetchImpl))).toEqual([
      { id: "c1", name: "General" },
    ]);
  });
});

const shopCtx = (fetchImpl: typeof fetch): ToolContext => ({
  ...ctx(fetchImpl),
  account: "acme.myshopify.com",
});

describe("shopify_list_products", () => {
  it("trims products to id, title, price and stock", async () => {
    const fetchImpl = stub({
      "graphql.json": {
        data: {
          products: {
            edges: [
              {
                node: {
                  id: "gid://shopify/Product/1",
                  title: "Tee",
                  status: "ACTIVE",
                  variants: {
                    edges: [
                      {
                        node: {
                          id: "gid://shopify/ProductVariant/1",
                          price: "20.00",
                          inventoryQuantity: 7,
                        },
                      },
                    ],
                  },
                },
              },
            ],
          },
        },
      },
    });
    const out = await toolNamed("shopify_list_products")!.run({ query: "" }, shopCtx(fetchImpl));
    expect(out).toEqual([
      {
        id: "gid://shopify/Product/1",
        title: "Tee",
        status: "ACTIVE",
        variantId: "gid://shopify/ProductVariant/1",
        price: "20.00",
        stock: 7,
      },
    ]);
  });

  it("surfaces GraphQL errors", async () => {
    const fetchImpl = stub({ "graphql.json": { errors: [{ message: "Bad query" }] } });
    await expect(
      toolNamed("shopify_list_products")!.run({ query: "" }, shopCtx(fetchImpl)),
    ).rejects.toThrow("Bad query");
  });
});

describe("shopify_list_orders", () => {
  it("trims orders to name, status and total", async () => {
    const fetchImpl = stub({
      "graphql.json": {
        data: {
          orders: {
            edges: [
              {
                node: {
                  id: "gid://shopify/Order/1",
                  name: "#1001",
                  createdAt: "2026-10-01T00:00:00Z",
                  displayFinancialStatus: "PAID",
                  displayFulfillmentStatus: "FULFILLED",
                  totalPriceSet: { shopMoney: { amount: "20.00", currencyCode: "USD" } },
                },
              },
            ],
          },
        },
      },
    });
    const out = await toolNamed("shopify_list_orders")!.run({}, shopCtx(fetchImpl));
    expect(out).toEqual([
      {
        id: "gid://shopify/Order/1",
        name: "#1001",
        at: "2026-10-01T00:00:00Z",
        paid: "PAID",
        fulfilled: "FULFILLED",
        total: "20.00 USD",
      },
    ]);
  });
});

describe("shopify_update_product", () => {
  it("updates title and status", async () => {
    const fetchImpl = stub({
      "graphql.json": {
        data: {
          productUpdate: {
            product: { id: "gid://1", title: "New", status: "DRAFT" },
            userErrors: [],
          },
        },
      },
    });
    const out = await toolNamed("shopify_update_product")!.run(
      { id: "gid://1", title: "New", status: "DRAFT" },
      shopCtx(fetchImpl),
    );
    expect(out).toEqual({ updated: true, id: "gid://1", title: "New", status: "DRAFT" });
  });

  it("needs a change and surfaces user errors", async () => {
    const fetchImpl = stub({
      "graphql.json": {
        data: { productUpdate: { product: null, userErrors: [{ message: "Nope" }] } },
      },
    });
    await expect(
      toolNamed("shopify_update_product")!.run(
        { id: "gid://1", title: "", status: "" },
        shopCtx(fetchImpl),
      ),
    ).rejects.toThrow(/new title or status/);
    await expect(
      toolNamed("shopify_update_product")!.run(
        { id: "gid://1", title: "x", status: "" },
        shopCtx(fetchImpl),
      ),
    ).rejects.toThrow("Nope");
  });
});

describe("mailchimp_list_audiences", () => {
  it("hits the key's own server", async () => {
    let url = "";
    const fetchImpl = (async (u: string) => {
      url = u;
      return Response.json({ lists: [{ id: "a1", name: "News", stats: { member_count: 42 } }] });
    }) as unknown as typeof fetch;
    const out = await toolNamed("mailchimp_list_audiences")!.run(
      {},
      { ...ctx(fetchImpl), token: "abc123-us21" },
    );
    expect(url).toBe(
      "https://us21.api.mailchimp.com/3.0/lists?fields=lists.id,lists.name,lists.stats.member_count&count=20",
    );
    expect(out).toEqual([{ id: "a1", name: "News", members: 42 }]);
  });

  it("refuses a key with no server suffix", async () => {
    const fetchImpl = stub({});
    await expect(toolNamed("mailchimp_list_audiences")!.run({}, ctx(fetchImpl))).rejects.toThrow(
      /server suffix/,
    );
  });
});

describe("mailchimp_add_member", () => {
  it("subscribes the email", async () => {
    const fetchImpl = (async (u: string, init?: RequestInit) => {
      expect(u).toContain("/lists/a1/members");
      expect(JSON.parse(String(init?.body))).toEqual({
        email_address: "a@b.c",
        status: "subscribed",
      });
      return Response.json({ id: "m1", email_address: "a@b.c" });
    }) as unknown as typeof fetch;
    const out = await toolNamed("mailchimp_add_member")!.run(
      { audience_id: "a1", email: "a@b.c" },
      { ...ctx(fetchImpl), token: "abc123-us21" },
    );
    expect(out).toEqual({ added: true, id: "m1", email: "a@b.c" });
  });
});
