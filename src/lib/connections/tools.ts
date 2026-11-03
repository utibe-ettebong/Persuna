/**
 * What Persuna can do in each connected app. Reads run straight away;
 * anything that sends or creates ("writes") waits for the user's OK. Results
 * are kept short: a few fields per item, never whole mailboxes.
 */
import { z } from "zod";
import { saveTextToDrive, saveTextToOneDrive, type SaveFormat } from "@/lib/docs/save";
import { localToUtc, type OffsetMinutes } from "@/lib/persuna/when";
import { META_GRAPH_VERSION, X_API, type Provider } from "./providers";

export interface ToolContext {
  token: string;
  /** Which account the token belongs to (a Shopify shop); null when unneeded. */
  account?: string | null;
  offset: OffsetMinutes;
  fetch: typeof fetch;
}

/** Pinned Shopify Admin API version. */
export const SHOPIFY_API_VERSION = "2026-07";

/** Mailchimp's API root comes from the key's suffix (abc123-us21). */
export function mailchimpBase(token: string): string {
  const suffix = token.split("-").at(-1) ?? "";
  if (!suffix || !/^[a-z]{2}\d+$/.test(suffix)) {
    throw new Error("That Mailchimp key has no server suffix (it ends -us21 or similar).");
  }
  return `https://${suffix}.api.mailchimp.com/3.0`;
}

export interface Tool<A extends z.ZodType = z.ZodType> {
  name: string;
  provider: Provider;
  /** For the model: what it does and the args it takes. */
  description: string;
  args: A;
  /** Sends or creates something: the user confirms first. */
  writes: boolean;
  /** For the user, before they confirm. */
  preview?: (args: z.infer<A>) => string;
  run: (args: z.infer<A>, ctx: ToolContext) => Promise<unknown>;
}

const tool = <A extends z.ZodType>(t: Tool<A>) => t as unknown as Tool;

async function call(
  ctx: ToolContext,
  url: string,
  init: RequestInit = {},
  extra: Record<string, string> = {},
) {
  const res = await ctx.fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${ctx.token}`, "content-type": "application/json", ...extra },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

/** POST/PUT/PATCH where success carries no body (202 Accepted). */
async function callVoid(ctx: ToolContext, url: string, init: RequestInit = {}): Promise<void> {
  const res = await ctx.fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${ctx.token}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

/** Plain text from a provider API (exported docs, file contents). */
async function callText(ctx: ToolContext, url: string, init: RequestInit = {}): Promise<string> {
  const res = await ctx.fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${ctx.token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const CALENDAR = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const NOTION = "https://api.notion.com/v1";
const NOTION_HEADERS = { "notion-version": "2022-06-28" };
const META = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const TWEET_FIELDS = "created_at,public_metrics";
const DRIVE = "https://www.googleapis.com/drive/v3/files";
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const DOCS = "https://docs.googleapis.com/v1/documents";
const SLIDES = "https://slides.googleapis.com/v1/presentations";
const GRAPH = "https://graph.microsoft.com/v1.0";
const localTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "YYYY-MM-DDTHH:mm");

/** An RFC 822 message, base64url-encoded as Gmail wants it. */
export function rawEmail(input: { to: string; subject: string; body: string }): string {
  const subject = `=?UTF-8?B?${Buffer.from(input.subject, "utf8").toString("base64")}?=`;
  return Buffer.from(
    [
      `To: ${input.to}`,
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "",
      input.body,
    ].join("\r\n"),
    "utf8",
  ).toString("base64url");
}

const email = z.object({
  to: z.string().trim().min(3).max(500),
  subject: z.string().trim().max(300),
  body: z.string().trim().min(1).max(20_000),
});

/** A Facebook Page the user manages, with its token and linked Instagram account. */
interface MetaPage {
  id: string;
  name: string;
  category: string | null;
  token: string | null;
  instagram: { id: string; username: string } | null;
}

async function metaPages(ctx: ToolContext): Promise<MetaPage[]> {
  const data = await call(
    ctx,
    `${META}/me/accounts?fields=id,name,category,access_token,instagram_business_account{id,username}&limit=25`,
  );
  return ((data.data ?? []) as Record<string, unknown>[]).map((p) => {
    const ig = p.instagram_business_account as { id?: string; username?: string } | undefined;
    return {
      id: String(p.id ?? ""),
      name: String(p.name ?? "Untitled page"),
      category: typeof p.category === "string" ? p.category : null,
      token: typeof p.access_token === "string" ? p.access_token : null,
      instagram:
        ig?.id && ig.username ? { id: String(ig.id), username: String(ig.username) } : null,
    };
  });
}

/** The user's Page by id or name; page work always goes through its own token. */
async function resolvePage(ctx: ToolContext, page: string): Promise<MetaPage> {
  const pages = await metaPages(ctx);
  const want = page.trim();
  const lowered = want.toLowerCase();
  const found =
    pages.find((p) => p.id === want) ??
    pages.find((p) => p.name.toLowerCase() === lowered) ??
    pages.find((p) => p.name.toLowerCase().includes(lowered));
  if (!found) {
    throw new Error(
      pages.length
        ? `No Facebook Page called "${want}". Yours: ${pages.map((p) => p.name).join(", ")}.`
        : "No Facebook Pages on this account. Create one, or connect the account that owns it.",
    );
  }
  return found;
}

const notionTitle = (page: Record<string, unknown>) => {
  const props = (page.properties ?? {}) as Record<
    string,
    { type?: string; title?: { plain_text?: string }[] }
  >;
  const title = Object.values(props).find((p) => p.type === "title")?.title;
  return title?.map((t) => t.plain_text ?? "").join("") || "Untitled";
};

export const TOOLS: Tool[] = [
  tool({
    name: "gmail_search",
    provider: "google",
    description:
      'Search the user\'s Gmail. args: {"query": Gmail search like "from:ada newer_than:7d"}',
    args: z.object({ query: z.string().trim().max(300) }),
    writes: false,
    async run({ query }, ctx) {
      const list = await call(ctx, `${GMAIL}/messages?maxResults=5&q=${encodeURIComponent(query)}`);
      const ids = ((list.messages ?? []) as { id: string }[]).map((m) => m.id);
      return Promise.all(
        ids.map(async (id) => {
          const m = await call(
            ctx,
            `${GMAIL}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
          );
          const headers =
            (m.payload as { headers?: { name: string; value: string }[] })?.headers ?? [];
          const h = (n: string) => headers.find((x) => x.name === n)?.value ?? "";
          return {
            from: h("From"),
            subject: h("Subject"),
            date: h("Date"),
            snippet: String(m.snippet ?? "").slice(0, 300),
          };
        }),
      );
    },
  }),
  tool({
    name: "gmail_draft",
    provider: "google",
    description:
      'Save an email as a draft in Gmail (nothing is sent). args: {"to", "subject", "body"}',
    args: email,
    writes: false,
    async run(args, ctx) {
      await call(ctx, `${GMAIL}/drafts`, {
        method: "POST",
        body: JSON.stringify({ message: { raw: rawEmail(args) } }),
      });
      return { saved: "draft" };
    },
  }),
  tool({
    name: "gmail_send",
    provider: "google",
    description: 'Send an email from the user\'s Gmail. args: {"to", "subject", "body"}',
    args: email,
    writes: true,
    preview: (a) => `Send an email to ${a.to}: "${a.subject}"\n\n${a.body}`,
    async run(args, ctx) {
      await call(ctx, `${GMAIL}/messages/send`, {
        method: "POST",
        body: JSON.stringify({ raw: rawEmail(args) }),
      });
      return { sent: true };
    },
  }),
  tool({
    name: "calendar_list",
    provider: "google",
    description:
      'List the user\'s calendar events. args: {"from": local "YYYY-MM-DDTHH:mm", "days": 1-14}',
    args: z.object({ from: localTime, days: z.number().int().min(1).max(14) }),
    writes: false,
    async run({ from, days }, ctx) {
      const start = localToUtc(from, ctx.offset)!;
      const end = new Date(start.getTime() + days * 86_400_000);
      const data = await call(
        ctx,
        `${CALENDAR}?singleEvents=true&orderBy=startTime&maxResults=15&timeMin=${start.toISOString()}&timeMax=${end.toISOString()}`,
      );
      return ((data.items ?? []) as Record<string, unknown>[]).map((e) => ({
        title: e.summary ?? "(no title)",
        start:
          (e.start as { dateTime?: string; date?: string })?.dateTime ??
          (e.start as { date?: string })?.date,
        end:
          (e.end as { dateTime?: string; date?: string })?.dateTime ??
          (e.end as { date?: string })?.date,
      }));
    },
  }),
  tool({
    name: "calendar_create",
    provider: "google",
    description:
      'Add an event to the user\'s calendar. args: {"title", "start": local "YYYY-MM-DDTHH:mm", "end": local time or null (30 minutes), "attendees": [emails] or []}',
    args: z.object({
      title: z.string().trim().min(1).max(300),
      start: localTime,
      end: localTime.nullish(),
      attendees: z.array(z.string().email()).max(20).default([]),
    }),
    writes: true,
    preview: (a) =>
      `Add "${a.title}" to your calendar on ${a.start.replace("T", " at ")}${a.attendees.length ? `, inviting ${a.attendees.join(", ")}` : ""}`,
    async run({ title, start, end, attendees }, ctx) {
      const from = localToUtc(start, ctx.offset)!;
      const to = end ? localToUtc(end, ctx.offset)! : new Date(from.getTime() + 30 * 60_000);
      const event = await call(ctx, `${CALENDAR}?sendUpdates=all`, {
        method: "POST",
        body: JSON.stringify({
          summary: title,
          start: { dateTime: from.toISOString() },
          end: { dateTime: to.toISOString() },
          attendees: attendees.map((e) => ({ email: e })),
        }),
      });
      return { created: true, link: event.htmlLink ?? null };
    },
  }),
  tool({
    name: "notion_search",
    provider: "notion",
    description: 'Find pages in the user\'s Notion. args: {"query": words, or "" for recent pages}',
    args: z.object({ query: z.string().trim().max(200) }),
    writes: false,
    async run({ query }, ctx) {
      const data = await call(
        ctx,
        `${NOTION}/search`,
        {
          method: "POST",
          body: JSON.stringify({
            query,
            page_size: 6,
            filter: { property: "object", value: "page" },
          }),
        },
        NOTION_HEADERS,
      );
      return ((data.results ?? []) as Record<string, unknown>[]).map((p) => ({
        id: p.id,
        title: notionTitle(p),
        url: p.url,
      }));
    },
  }),
  tool({
    name: "notion_create_page",
    provider: "notion",
    description:
      'Add a page inside an existing Notion page (find the parent with notion_search first). args: {"parent_id", "parent_title", "title", "body": plain text, paragraphs separated by blank lines}',
    args: z.object({
      parent_id: z.string().trim().min(8).max(64),
      parent_title: z.string().trim().max(200).default(""),
      title: z.string().trim().min(1).max(200),
      body: z.string().trim().max(20_000).default(""),
    }),
    writes: true,
    preview: (a) =>
      `Add a Notion page "${a.title}"${a.parent_title ? ` under "${a.parent_title}"` : ""}\n\n${a.body}`,
    async run({ parent_id, title, body }, ctx) {
      const paragraphs = body
        .split(/\n\s*\n/)
        .filter(Boolean)
        .slice(0, 90);
      const page = await call(
        ctx,
        `${NOTION}/pages`,
        {
          method: "POST",
          body: JSON.stringify({
            parent: { page_id: parent_id },
            properties: { title: { title: [{ text: { content: title } }] } },
            children: paragraphs.map((p) => ({
              object: "block",
              type: "paragraph",
              paragraph: { rich_text: [{ type: "text", text: { content: p.slice(0, 1900) } }] },
            })),
          }),
        },
        NOTION_HEADERS,
      );
      return { created: true, url: page.url ?? null };
    },
  }),
  tool({
    name: "meta_list_pages",
    provider: "meta",
    description:
      "List the Facebook Pages this user manages, with any linked Instagram business account. args: {} (no arguments)",
    args: z.object({}),
    writes: false,
    async run(_args, ctx) {
      // Names and handles only: page tokens never leave this call.
      return (await metaPages(ctx)).map((p) => ({
        name: p.name,
        category: p.category,
        instagram: p.instagram?.username ?? null,
      }));
    },
  }),
  tool({
    name: "facebook_list_posts",
    provider: "meta",
    description:
      'Recent posts on one of the user\'s Facebook Pages. args: {"page": name or id, "limit": 1-10}',
    args: z.object({
      page: z.string().trim().min(1).max(200),
      limit: z.number().int().min(1).max(10).default(5),
    }),
    writes: false,
    async run({ page, limit }, ctx) {
      const found = await resolvePage(ctx, page);
      if (!found.token) throw new Error(`I can't open "${found.name}" right now. Reconnect Meta.`);
      const data = await call(
        ctx,
        `${META}/${found.id}/posts?fields=message,created_time,permalink_url,likes.summary(true).limit(0),comments.summary(true).limit(0)&limit=${limit}`,
        {},
        { authorization: `Bearer ${found.token}` },
      );
      return ((data.data ?? []) as Record<string, unknown>[]).map((p) => ({
        message: String(p.message ?? "").slice(0, 300),
        at: p.created_time ?? null,
        url: p.permalink_url ?? null,
        likes: (p.likes as { summary?: { total_count?: number } })?.summary?.total_count ?? null,
        comments:
          (p.comments as { summary?: { total_count?: number } })?.summary?.total_count ?? null,
      }));
    },
  }),
  tool({
    name: "instagram_list_media",
    provider: "meta",
    description:
      'Recent posts on the Instagram business account linked to one of the user\'s Facebook Pages. args: {"page": name or id, "limit": 1-10}',
    args: z.object({
      page: z.string().trim().min(1).max(200),
      limit: z.number().int().min(1).max(10).default(5),
    }),
    writes: false,
    async run({ page, limit }, ctx) {
      const found = await resolvePage(ctx, page);
      if (!found.instagram) {
        throw new Error(
          `"${found.name}" has no linked Instagram business account. Link one in the Page's settings first.`,
        );
      }
      const data = await call(
        ctx,
        `${META}/${found.instagram.id}/media?fields=caption,timestamp,permalink,like_count,comments_count&limit=${limit}`,
      );
      return ((data.data ?? []) as Record<string, unknown>[]).map((m) => ({
        caption: String(m.caption ?? "").slice(0, 300),
        at: m.timestamp ?? null,
        url: m.permalink ?? null,
        likes: m.like_count ?? null,
        comments: m.comments_count ?? null,
      }));
    },
  }),
  tool({
    name: "facebook_post",
    provider: "meta",
    description:
      'Post text (and an optional link) to one of the user\'s Facebook Pages. args: {"page": name or id, "message", "link": URL or null}',
    args: z.object({
      page: z.string().trim().min(1).max(200),
      message: z.string().trim().min(1).max(5000),
      link: z.string().trim().url().max(2000).nullish(),
    }),
    writes: true,
    preview: (a) =>
      `Post to the "${a.page}" Facebook Page:\n\n${a.message}${a.link ? `\n\n${a.link}` : ""}`,
    async run({ page, message, link }, ctx) {
      const found = await resolvePage(ctx, page);
      if (!found.token)
        throw new Error(`I can't post as "${found.name}" right now. Reconnect Meta.`);
      const posted = await call(
        ctx,
        `${META}/${found.id}/feed`,
        {
          method: "POST",
          body: JSON.stringify({ message, ...(link ? { link } : {}) }),
        },
        { authorization: `Bearer ${found.token}` },
      );
      return { posted: true, id: posted.id ?? null };
    },
  }),
  tool({
    name: "x_list_posts",
    provider: "x",
    description: 'Your recent posts on X. args: {"limit": 5-20}',
    args: z.object({ limit: z.number().int().min(5).max(20).default(10) }),
    writes: false,
    async run({ limit }, ctx) {
      const data = await call(
        ctx,
        `${X_API}/users/me/tweets?max_results=${limit}&tweet.fields=${TWEET_FIELDS}`,
      );
      return mapTweets(data);
    },
  }),
  tool({
    name: "x_list_mentions",
    provider: "x",
    description: 'Recent posts on X that mention you. args: {"limit": 5-20}',
    args: z.object({ limit: z.number().int().min(5).max(20).default(10) }),
    writes: false,
    async run({ limit }, ctx) {
      const data = await call(
        ctx,
        `${X_API}/users/me/mentions?max_results=${limit}&tweet.fields=${TWEET_FIELDS}`,
      );
      return mapTweets(data);
    },
  }),
  tool({
    name: "x_post",
    provider: "x",
    description: 'Post to X as you (280 characters max). args: {"text"}',
    args: z.object({ text: z.string().trim().min(1).max(280) }),
    writes: true,
    preview: (a) => `Post to X:\n\n${a.text}`,
    async run({ text }, ctx) {
      const posted = (await call(ctx, `${X_API}/tweets`, {
        method: "POST",
        body: JSON.stringify({ text }),
      })) as { data?: { id?: string } };
      return { posted: true, id: posted.data?.id ?? null };
    },
  }),
  tool({
    name: "drive_list_files",
    provider: "google",
    description:
      'Your most recently changed Drive files, optionally filtered by name. args: {"query": name contains, "limit": 1-10}',
    args: z.object({
      query: z.string().trim().max(200).default(""),
      limit: z.number().int().min(1).max(10).default(5),
    }),
    writes: false,
    async run({ query, limit }, ctx) {
      const q = encodeURIComponent(
        query
          ? `trashed = false and name contains '${query.replace(/'/g, "\\'")}'`
          : "trashed = false",
      );
      const data = await call(
        ctx,
        `${DRIVE}?q=${q}&fields=files(id,name,mimeType,modifiedTime,size)&orderBy=modifiedTime desc&pageSize=${limit}`,
      );
      return ((data.files ?? []) as Record<string, unknown>[]).map((f) => {
        const file = driveFile(f);
        return { name: file.name, kind: driveKind(file.mimeType), modified: file.modifiedTime };
      });
    },
  }),
  tool({
    name: "drive_read_file",
    provider: "google",
    description:
      'Read a Drive file as text (Docs and text files; spreadsheets come back as CSV). args: {"file": name or id}',
    args: z.object({ file: z.string().trim().min(1).max(200) }),
    writes: false,
    async run({ file }, ctx) {
      const found = await resolveDriveFile(ctx, file);
      if (found.mimeType === "application/vnd.google-apps.folder") {
        throw new Error(`"${found.name}" is a folder. Name a file inside it.`);
      }
      // Google-native files export; uploaded ones download (when small enough to read).
      const url =
        found.mimeType === "application/vnd.google-apps.spreadsheet"
          ? `${DRIVE}/${found.id}/export?mimeType=${encodeURIComponent("text/csv")}`
          : found.mimeType.startsWith("application/vnd.google-apps.")
            ? `${DRIVE}/${found.id}/export?mimeType=${encodeURIComponent("text/plain")}`
            : found.size !== null && found.size > 200_000
              ? null
              : `${DRIVE}/${found.id}?alt=media`;
      if (!url) throw new Error(`"${found.name}" is too big to read here.`);
      const text = await callText(ctx, url);
      return { name: found.name, text: text.slice(0, 6000), truncated: text.length > 6000 };
    },
  }),
  tool({
    name: "sheets_read_range",
    provider: "google",
    description:
      'Read cells from a Google Sheet (first 50 rows). args: {"spreadsheet": name or id, "range": e.g. "Sheet1!A1:D" (default "A1:Z50")}',
    args: z.object({
      spreadsheet: z.string().trim().min(1).max(200),
      range: z.string().trim().min(1).max(100).default("A1:Z50"),
    }),
    writes: false,
    async run({ spreadsheet, range }, ctx) {
      const found = await resolveDriveFile(
        ctx,
        spreadsheet,
        " and mimeType = 'application/vnd.google-apps.spreadsheet'",
      );
      const data = await call(ctx, `${SHEETS}/${found.id}/values/${encodeURIComponent(range)}`);
      const rows = ((data.values ?? []) as unknown[][] as string[][])
        .slice(0, 50)
        .map((r) => r.slice(0, 26).map((c) => String(c ?? "")));
      return { name: found.name, range: String(data.range ?? range), rows };
    },
  }),
  tool({
    name: "sheets_append_row",
    provider: "google",
    description:
      'Add one row to a Google Sheet. args: {"spreadsheet": name or id, "range": e.g. "Sheet1!A:D", "values": cells}',
    args: z.object({
      spreadsheet: z.string().trim().min(1).max(200),
      range: z.string().trim().min(1).max(100),
      values: z.array(z.string().max(5000)).min(1).max(26),
    }),
    writes: true,
    preview: (a) => `Add to "${a.spreadsheet}" (${a.range}):\n\n${a.values.join(" | ")}`,
    async run({ spreadsheet, range, values }, ctx) {
      const found = await resolveDriveFile(
        ctx,
        spreadsheet,
        " and mimeType = 'application/vnd.google-apps.spreadsheet'",
      );
      await call(
        ctx,
        `${SHEETS}/${found.id}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`,
        { method: "POST", body: JSON.stringify({ values: [values] }) },
      );
      return { added: true };
    },
  }),
  tool({
    name: "docs_create",
    provider: "google",
    description: 'Create a blank Google Doc. args: {"title", "body": opening text or ""}',
    args: z.object({
      title: z.string().trim().min(1).max(200),
      body: z.string().max(20_000).default(""),
    }),
    writes: true,
    preview: (a) => `Create a Google Doc "${a.title}"`,
    async run({ title, body }, ctx) {
      const doc = await call(ctx, DOCS, {
        method: "POST",
        body: JSON.stringify({ title }),
      });
      const id = String(doc.documentId ?? "");
      if (body.trim() && id) {
        await call(ctx, `${DOCS}/${id}:batchUpdate`, {
          method: "POST",
          body: JSON.stringify({
            requests: [{ insertText: { endOfSegmentLocation: {}, text: body } }],
          }),
        });
      }
      return {
        created: true,
        id,
        link: id ? `https://docs.google.com/document/d/${id}/edit` : null,
      };
    },
  }),
  tool({
    name: "docs_append_text",
    provider: "google",
    description: 'Add text to the end of a Google Doc. args: {"document": name or id, "text"}',
    args: z.object({
      document: z.string().trim().min(1).max(200),
      text: z.string().trim().min(1).max(20_000),
    }),
    writes: true,
    preview: (a) => `Add to "${a.document}":\n\n${a.text.slice(0, 300)}`,
    async run({ document, text }, ctx) {
      const found = await resolveDriveFile(
        ctx,
        document,
        " and mimeType = 'application/vnd.google-apps.document'",
      );
      await call(ctx, `${DOCS}/${found.id}:batchUpdate`, {
        method: "POST",
        body: JSON.stringify({
          requests: [{ insertText: { endOfSegmentLocation: {}, text: `\n${text}` } }],
        }),
      });
      return { added: true, id: found.id, name: found.name };
    },
  }),
  tool({
    name: "sheets_create_spreadsheet",
    provider: "google",
    description: 'Create a blank Google Sheet. args: {"title"}',
    args: z.object({ title: z.string().trim().min(1).max(200) }),
    writes: true,
    preview: (a) => `Create a Google Sheet "${a.title}"`,
    async run({ title }, ctx) {
      const sheet = await call(ctx, SHEETS, {
        method: "POST",
        body: JSON.stringify({ properties: { title } }),
      });
      const id = String(sheet.spreadsheetId ?? "");
      return {
        created: true,
        id,
        link: id ? `https://docs.google.com/spreadsheets/d/${id}/edit` : null,
      };
    },
  }),
  tool({
    name: "slides_create_presentation",
    provider: "google",
    description: 'Create a blank Google Slides deck. args: {"title"}',
    args: z.object({ title: z.string().trim().min(1).max(200) }),
    writes: true,
    preview: (a) => `Create a Slides deck "${a.title}"`,
    async run({ title }, ctx) {
      const deck = await call(ctx, SLIDES, {
        method: "POST",
        body: JSON.stringify({ title }),
      });
      const id = String(deck.presentationId ?? "");
      return {
        created: true,
        id,
        link: id ? `https://docs.google.com/presentation/d/${id}/edit` : null,
      };
    },
  }),
  tool({
    name: "drive_upload",
    provider: "google",
    description:
      'Save text as a file in the user\'s Google Drive (Office formats open as editable Docs, Sheets or Slides by default). args: {"name", "format": "md|docx|pdf|pptx|xlsx", "text": Markdown (CSV for xlsx), "convert": true}',
    args: z.object({
      name: z.string().trim().min(1).max(120),
      format: z.enum(["md", "docx", "pdf", "pptx", "xlsx"]).default("docx"),
      text: z.string().max(200_000),
      convert: z.boolean().default(true),
    }),
    writes: true,
    preview: (a) => `Save ${a.name}.${a.format} to Google Drive`,
    async run({ name, format, text, convert }, ctx) {
      const saved = await saveTextToDrive({
        token: ctx.token,
        title: name,
        body: text,
        format: format as SaveFormat,
        convert,
        fetchFn: ctx.fetch,
      });
      return { saved: true, name: saved.name, link: saved.link };
    },
  }),
  tool({
    name: "onedrive_upload",
    provider: "microsoft",
    description:
      'Save text as a file in the user\'s OneDrive. args: {"name", "format": "md|docx|pdf|pptx|xlsx", "text": Markdown (CSV for xlsx)}',
    args: z.object({
      name: z.string().trim().min(1).max(120),
      format: z.enum(["md", "docx", "pdf", "pptx", "xlsx"]).default("docx"),
      text: z.string().max(200_000),
    }),
    writes: true,
    preview: (a) => `Save ${a.name}.${a.format} to OneDrive`,
    async run({ name, format, text }, ctx) {
      const saved = await saveTextToOneDrive({
        token: ctx.token,
        title: name,
        body: text,
        format: format as SaveFormat,
        fetchFn: ctx.fetch,
      });
      return { saved: true, name: saved.name, link: saved.link };
    },
  }),
  tool({
    name: "onedrive_list_files",
    provider: "microsoft",
    description:
      'List files and folders in the user\'s OneDrive. args: {"folder": path or "" for the root}',
    args: z.object({ folder: z.string().trim().max(400).default("") }),
    writes: false,
    async run({ folder }, ctx) {
      const base = folder
        ? `${GRAPH}/me/drive/root:/${encodeURIComponent(folder)}:`
        : `${GRAPH}/me/drive/root`;
      const data = await call(ctx, `${base}/children?$select=name,folder,file,size&$top=50`);
      return ((data.value ?? []) as Record<string, unknown>[]).map((v) => ({
        name: String(v.name ?? ""),
        folder: Boolean(v.folder),
        size: typeof v.size === "number" ? v.size : null,
      }));
    },
  }),
  tool({
    name: "excel_read_range",
    provider: "microsoft",
    description:
      'Read cells from an Excel workbook in OneDrive (first 50 rows). args: {"file": name or id, "worksheet": name or "" for the first sheet, "range": e.g. "A1:D" (default "A1:Z50")}',
    args: z.object({
      file: z.string().trim().min(1).max(200),
      worksheet: z.string().trim().max(100).default(""),
      range: z.string().trim().min(1).max(100).default("A1:Z50"),
    }),
    writes: false,
    async run({ file, worksheet, range }, ctx) {
      const found = await resolveOneDriveFile(ctx, file);
      const sheet = worksheet || (await firstWorksheet(ctx, found.id));
      const data = await call(
        ctx,
        `${GRAPH}/me/drive/items/${found.id}/workbook/worksheets/${encodeURIComponent(sheet)}/range(address='${encodeURIComponent(range)}')`,
      );
      const values = ((data.values ?? []) as unknown[][])
        .slice(0, 50)
        .map((r) => r.slice(0, 26).map((c) => String(c ?? "")));
      return { name: found.name, worksheet: sheet, values };
    },
  }),
  tool({
    name: "excel_update_range",
    provider: "microsoft",
    description:
      'Write cells into an Excel workbook in OneDrive. args: {"file": name or id, "worksheet": name or "" for the first sheet, "range": e.g. "A1:B2", "values": rows of cells}',
    args: z.object({
      file: z.string().trim().min(1).max(200),
      worksheet: z.string().trim().max(100).default(""),
      range: z.string().trim().min(1).max(100),
      values: z
        .array(z.array(z.string().max(5000)).max(26))
        .min(1)
        .max(50),
    }),
    writes: true,
    preview: (a) => `Write to "${a.file}" (${a.range})`,
    async run({ file, worksheet, range, values }, ctx) {
      const found = await resolveOneDriveFile(ctx, file);
      const sheet = worksheet || (await firstWorksheet(ctx, found.id));
      await call(
        ctx,
        `${GRAPH}/me/drive/items/${found.id}/workbook/worksheets/${encodeURIComponent(sheet)}/range(address='${encodeURIComponent(range)}')`,
        { method: "PATCH", body: JSON.stringify({ values }) },
      );
      return { updated: true, name: found.name, worksheet: sheet, range };
    },
  }),
  tool({
    name: "outlook_list_messages",
    provider: "microsoft",
    description:
      'List recent Outlook mail. args: {"folder": "inbox" or "sentitems", "top": how many (default 10, max 25)}',
    args: z.object({
      folder: z.enum(["inbox", "sentitems"]).default("inbox"),
      top: z.number().int().min(1).max(25).default(10),
    }),
    writes: false,
    async run({ folder, top }, ctx) {
      const data = await call(
        ctx,
        `${GRAPH}/me/mailFolders/${folder}/messages?$top=${top}&$select=subject,from,receivedDateTime,bodyPreview&$orderby=receivedDateTime desc`,
      );
      return ((data.value ?? []) as Record<string, unknown>[]).map((m) => {
        const from = m.from as Record<string, Record<string, string>> | undefined;
        return {
          subject: String(m.subject ?? "(no subject)"),
          from: from?.emailAddress?.address ?? null,
          at: String(m.receivedDateTime ?? ""),
          preview: String(m.bodyPreview ?? "").slice(0, 300),
        };
      });
    },
  }),
  tool({
    name: "outlook_send",
    provider: "microsoft",
    description:
      'Send an email from the user\'s Outlook. args: {"to": email, "subject", "body": plain text}',
    args: z.object({
      to: z.string().trim().email().max(200),
      subject: z.string().trim().min(1).max(300),
      body: z.string().max(50_000),
    }),
    writes: true,
    preview: (a) => `Email ${a.to} — "${a.subject}"\n\n${a.body.slice(0, 300)}`,
    async run({ to, subject, body }, ctx) {
      await callVoid(ctx, `${GRAPH}/me/sendMail`, {
        method: "POST",
        body: JSON.stringify({
          message: {
            subject,
            body: { contentType: "Text", content: body },
            toRecipients: [{ emailAddress: { address: to } }],
          },
          saveToSentItems: true,
        }),
      });
      return { sent: true };
    },
  }),
  tool({
    name: "teams_list",
    provider: "microsoft",
    description: "List the Teams the user belongs to. args: {} (no arguments)",
    args: z.object({}),
    writes: false,
    async run(_args, ctx) {
      const data = await call(ctx, `${GRAPH}/me/joinedTeams?$select=id,displayName`);
      return ((data.value ?? []) as Record<string, unknown>[]).map((t) => ({
        id: String(t.id ?? ""),
        name: String(t.displayName ?? ""),
      }));
    },
  }),
  tool({
    name: "teams_list_channels",
    provider: "microsoft",
    description: 'List a team\'s channels. args: {"team_id"}',
    args: z.object({ team_id: z.string().trim().min(1).max(200) }),
    writes: false,
    async run({ team_id }, ctx) {
      const data = await call(ctx, `${GRAPH}/teams/${team_id}/channels?$select=id,displayName`);
      return ((data.value ?? []) as Record<string, unknown>[]).map((c) => ({
        id: String(c.id ?? ""),
        name: String(c.displayName ?? ""),
      }));
    },
  }),
  tool({
    name: "teams_post_message",
    provider: "microsoft",
    description: 'Post a message to a Teams channel. args: {"team_id", "channel_id", "text"}',
    args: z.object({
      team_id: z.string().trim().min(1).max(200),
      channel_id: z.string().trim().min(1).max(200),
      text: z.string().trim().min(1).max(10_000),
    }),
    writes: true,
    preview: (a) => `Post to Teams:\n\n${a.text.slice(0, 300)}`,
    async run({ team_id, channel_id, text }, ctx) {
      const posted = await call(ctx, `${GRAPH}/teams/${team_id}/channels/${channel_id}/messages`, {
        method: "POST",
        body: JSON.stringify({ body: { contentType: "text", content: text } }),
      });
      return { posted: true, id: String(posted.id ?? "") };
    },
  }),
  tool({
    name: "shopify_list_products",
    provider: "shopify",
    description:
      'List products in the user\'s Shopify store. args: {"query": search words or "" (default 10 newest)}',
    args: z.object({ query: z.string().trim().max(200).default("") }),
    writes: false,
    async run({ query }, ctx) {
      const data = await shopify(ctx, {
        query: `query($q: String!) { products(first: 10, query: $q) { edges { node {
          id title status
          variants(first: 1) { edges { node { id price inventoryQuantity } } }
        } } } }`,
        variables: { q: query || null },
      });
      const edges = (data.products?.edges ?? []) as { node: Record<string, unknown> }[];
      return edges.map((e) => {
        const variants = e.node.variants as { edges?: { node: Record<string, unknown> }[] };
        const v = variants?.edges?.[0]?.node ?? {};
        return {
          id: String(e.node.id ?? ""),
          title: String(e.node.title ?? ""),
          status: String(e.node.status ?? ""),
          variantId: typeof v.id === "string" ? v.id : null,
          price: v.price != null ? String(v.price) : null,
          stock: typeof v.inventoryQuantity === "number" ? v.inventoryQuantity : null,
        };
      });
    },
  }),
  tool({
    name: "shopify_list_orders",
    provider: "shopify",
    description: "List the store's most recent orders. args: {} (no arguments)",
    args: z.object({}),
    writes: false,
    async run(_args, ctx) {
      const data = await shopify(ctx, {
        query: `{ orders(first: 10, sortKey: CREATED_AT, reverse: true) { edges { node {
          id name createdAt displayFinancialStatus displayFulfillmentStatus
          totalPriceSet { shopMoney { amount currencyCode } }
        } } } }`,
      });
      const edges = (data.orders?.edges ?? []) as Record<string, Record<string, unknown>>[];
      return edges.map((e) => {
        const money = (
          e.node.totalPriceSet as { shopMoney?: { amount: string; currencyCode: string } }
        )?.shopMoney;
        return {
          id: String(e.node.id ?? ""),
          name: String(e.node.name ?? ""),
          at: String(e.node.createdAt ?? ""),
          paid: String(e.node.displayFinancialStatus ?? ""),
          fulfilled: String(e.node.displayFulfillmentStatus ?? ""),
          total: money ? `${money.amount} ${money.currencyCode}` : null,
        };
      });
    },
  }),
  tool({
    name: "shopify_update_product",
    provider: "shopify",
    description:
      'Change a product\'s title or status. args: {"id": product id, "title": new title or "", "status": "ACTIVE"|"DRAFT"|"ARCHIVED" or ""}',
    args: z.object({
      id: z.string().trim().min(1).max(200),
      title: z.string().trim().max(200).default(""),
      status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED", ""]).default(""),
    }),
    writes: true,
    preview: (a) =>
      `Update product ${a.id}${a.title ? ` title to "${a.title}"` : ""}${a.status ? ` status to ${a.status}` : ""}`,
    async run({ id, title, status }, ctx) {
      if (!title && !status) throw new Error("Give a new title or status.");
      const data = await shopify(ctx, {
        query: `mutation($input: ProductInput!) { productUpdate(input: $input) {
          product { id title status }
          userErrors { message }
        } }`,
        variables: { input: { id, ...(title && { title }), ...(status && { status }) } },
      });
      const errors = (data.productUpdate?.userErrors ?? []) as { message?: string }[];
      if (errors.length) throw new Error(errors[0]?.message ?? "Shopify refused the update.");
      const product = (data.productUpdate?.product ?? {}) as Record<string, unknown>;
      return {
        updated: true,
        id: String(product.id ?? id),
        title: String(product.title ?? ""),
        status: String(product.status ?? ""),
      };
    },
  }),
  tool({
    name: "mailchimp_list_audiences",
    provider: "mailchimp",
    description: "List the user's Mailchimp audiences. args: {} (no arguments)",
    args: z.object({}),
    writes: false,
    async run(_args, ctx) {
      const data = await mailchimp(
        ctx,
        "/lists?fields=lists.id,lists.name,lists.stats.member_count&count=20",
      );
      return ((data.lists ?? []) as Record<string, unknown>[]).map((l) => ({
        id: String(l.id ?? ""),
        name: String(l.name ?? ""),
        members: Number((l.stats as Record<string, number> | undefined)?.member_count ?? 0),
      }));
    },
  }),
  tool({
    name: "mailchimp_add_member",
    provider: "mailchimp",
    description: 'Subscribe an email to a Mailchimp audience. args: {"audience_id", "email"}',
    args: z.object({
      audience_id: z.string().trim().min(1).max(100),
      email: z.string().trim().email().max(200),
    }),
    writes: true,
    preview: (a) => `Subscribe ${a.email} to audience ${a.audience_id}`,
    async run({ audience_id, email }, ctx) {
      const data = await mailchimp(ctx, `/lists/${audience_id}/members`, {
        method: "POST",
        body: JSON.stringify({ email_address: email, status: "subscribed" }),
      });
      return { added: true, id: String(data.id ?? ""), email: String(data.email_address ?? email) };
    },
  }),
];

/** Shopify Admin GraphQL: throws on transport and GraphQL errors alike. */
async function shopify(
  ctx: ToolContext,
  body: Record<string, unknown>,
): Promise<Record<string, { edges?: unknown[] } & Record<string, unknown>>> {
  if (!ctx.account) throw new Error("Connect the Shopify store first.");
  const res = await ctx.fetch(
    `https://${ctx.account}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": ctx.token,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as Record<string, unknown>;
  const errors = data.errors as { message?: string }[] | undefined;
  if (errors?.length) throw new Error(errors[0]?.message ?? "Shopify refused the call.");
  return (data.data ?? {}) as Record<string, { edges?: unknown[] } & Record<string, unknown>>;
}

/** Mailchimp Marketing API, rooted at the key's own server. */
async function mailchimp(
  ctx: ToolContext,
  path: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  const res = await ctx.fetch(`${mailchimpBase(ctx.token)}${path}`, {
    ...init,
    headers: {
      authorization: `Basic ${Buffer.from(`any:${ctx.token}`).toString("base64")}`,
      "content-type": "application/json",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

/** A Drive file, enough to open it the right way. */
interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string | null;
  size: number | null;
}

const driveFile = (f: Record<string, unknown>): DriveFile => ({
  id: String(f.id ?? ""),
  name: String(f.name ?? "Untitled"),
  mimeType: String(f.mimeType ?? ""),
  modifiedTime: typeof f.modifiedTime === "string" ? f.modifiedTime : null,
  size: f.size !== undefined && f.size !== null ? Number(f.size) : null,
});

async function driveSearch(ctx: ToolContext, name: string, extra = ""): Promise<DriveFile[]> {
  const q = encodeURIComponent(
    `trashed = false and name contains '${name.replace(/'/g, "\\'")}'${extra}`,
  );
  const data = await call(
    ctx,
    `${DRIVE}?q=${q}&fields=files(id,name,mimeType,modifiedTime,size)&orderBy=modifiedTime desc&pageSize=10`,
  );
  return ((data.files ?? []) as Record<string, unknown>[]).map(driveFile);
}

/** A Drive file by id or name (first match, newest first). */
async function resolveDriveFile(ctx: ToolContext, file: string, extra = ""): Promise<DriveFile> {
  const want = file.trim();
  if (/^[A-Za-z0-9_-]{10,}$/.test(want)) {
    try {
      return driveFile(
        await call(ctx, `${DRIVE}/${want}?fields=id,name,mimeType,modifiedTime,size`),
      );
    } catch {
      // Not an id after all: fall through and search by name.
    }
  }
  const [found] = await driveSearch(ctx, want, extra);
  if (!found) throw new Error(`No Drive file called "${want}".`);
  return found;
}

/** A OneDrive file by id, or the first file matching a name search. */
async function resolveOneDriveFile(
  ctx: ToolContext,
  file: string,
): Promise<{ id: string; name: string }> {
  const want = file.trim();
  if (/^[A-Za-z0-9!_-]{10,}$/.test(want)) {
    try {
      const data = await call(ctx, `${GRAPH}/me/drive/items/${want}?$select=id,name`);
      return { id: String(data.id), name: String(data.name ?? want) };
    } catch {
      // Not an id after all: fall through and search by name.
    }
  }
  const data = await call(
    ctx,
    `${GRAPH}/me/drive/root/search(q='${encodeURIComponent(want)}')?$select=id,name,file&$top=5`,
  );
  const hit = ((data.value ?? []) as Record<string, unknown>[]).find((v) => v.file);
  if (!hit) throw new Error(`No OneDrive file called "${want}".`);
  return { id: String(hit.id), name: String(hit.name) };
}

/** The first worksheet of an Excel workbook, when none is named. */
async function firstWorksheet(ctx: ToolContext, fileId: string): Promise<string> {
  const data = await call(
    ctx,
    `${GRAPH}/me/drive/items/${fileId}/workbook/worksheets?$select=name&$top=1`,
  );
  const [first] = (data.value ?? []) as Record<string, unknown>[];
  if (!first) throw new Error("That workbook has no worksheets.");
  return String(first.name ?? "");
}

const driveKind = (mime: string) =>
  mime === "application/vnd.google-apps.folder"
    ? "folder"
    : mime === "application/vnd.google-apps.document"
      ? "doc"
      : mime === "application/vnd.google-apps.spreadsheet"
        ? "sheet"
        : mime === "application/vnd.google-apps.presentation"
          ? "slides"
          : mime.startsWith("image/")
            ? "image"
            : mime === "application/pdf"
              ? "pdf"
              : "file";

/** X posts, trimmed for the model: words, when, link and counts. */
function mapTweets(data: Record<string, unknown>) {
  return ((data.data ?? []) as Record<string, unknown>[]).map((t) => {
    const metrics = (t.public_metrics ?? {}) as Record<string, number | undefined>;
    return {
      text: String(t.text ?? "").slice(0, 300),
      at: t.created_at ?? null,
      url: t.id ? `https://x.com/i/status/${t.id}` : null,
      likes: metrics.like_count ?? null,
      reposts: metrics.retweet_count ?? null,
      replies: metrics.reply_count ?? null,
    };
  });
}

export const toolNamed = (name: string) => TOOLS.find((t) => t.name === name) ?? null;
