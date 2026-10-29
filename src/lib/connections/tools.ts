/**
 * What Persuna can do in each connected app. Reads run straight away;
 * anything that sends or creates ("writes") waits for the user's OK. Results
 * are kept short: a few fields per item, never whole mailboxes.
 */
import { z } from "zod";
import { localToUtc, type OffsetMinutes } from "@/lib/persuna/when";
import type { Provider } from "./providers";

export interface ToolContext {
  token: string;
  offset: OffsetMinutes;
  fetch: typeof fetch;
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

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const CALENDAR = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const NOTION = "https://api.notion.com/v1";
const NOTION_HEADERS = { "notion-version": "2022-06-28" };
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
];

export const toolNamed = (name: string) => TOOLS.find((t) => t.name === name) ?? null;
