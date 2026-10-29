/**
 * Connected apps: storing, refreshing and removing each user's tokens, and
 * the OAuth round trip. Tokens are sealed with CONNECTIONS_KEY and never
 * leave the server; the audit log records connects, disconnects and every
 * app action by name only, never content.
 */
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { appConnections } from "@/db/schema";
import { env } from "@/env";
import { audit, type Actor } from "@/lib/audit";
import type { ModelClient } from "@/lib/models/gateway";
import type { OffsetMinutes } from "@/lib/persuna/when";
import { runAppTask } from "./agent";
import { readToken, seal, signToken, unseal } from "./crypto";
import {
  PROVIDERS,
  PROVIDER_IDS,
  authorizeUrl,
  exchangeCode,
  refreshAccess,
  type ClientCredentials,
  type Provider,
} from "./providers";
import { TOOLS, toolNamed } from "./tools";

/** The secret for sealing tokens, or null when connected apps aren't set up. */
export function connectionsKey(): string | null {
  return env().CONNECTIONS_KEY ?? null;
}

export function credentialsFor(provider: Provider): ClientCredentials | null {
  const e = env();
  const [clientId, clientSecret] =
    provider === "google"
      ? [e.GOOGLE_CLIENT_ID, e.GOOGLE_CLIENT_SECRET]
      : [e.NOTION_CLIENT_ID, e.NOTION_CLIENT_SECRET];
  return clientId && clientSecret && connectionsKey() ? { clientId, clientSecret } : null;
}

const redirectUri = (provider: Provider, origin: string) =>
  `${(env().APP_URL ?? origin).replace(/\/+$/, "")}/api/connections/${provider}/callback`;

/** Every app, whether it can be connected here, and whether this user has. */
export async function listConnections(userId: string) {
  const rows = await db()
    .select({
      provider: appConnections.provider,
      account: appConnections.account,
      createdAt: appConnections.createdAt,
    })
    .from(appConnections)
    .where(eq(appConnections.userId, userId));
  return PROVIDER_IDS.map((id) => {
    const row = rows.find((r) => r.provider === id);
    return {
      provider: id,
      name: PROVIDERS[id].name,
      apps: PROVIDERS[id].apps,
      available: Boolean(credentialsFor(id)),
      account: row?.account ?? null,
      connectedAt: row?.createdAt ?? null,
    };
  });
}

/** Providers this user has connected. */
export async function connectedProviders(userId: string): Promise<Provider[]> {
  const rows = await db()
    .select({ provider: appConnections.provider })
    .from(appConnections)
    .where(eq(appConnections.userId, userId));
  return rows.map((r) => r.provider).filter((p): p is Provider => p in PROVIDERS);
}

const STATE_TTL_MS = 10 * 60_000;

/** The cookie holding the OAuth nonce between the start and callback routes. */
export const NONCE_COOKIE = "persuna_connect";

/**
 * Where to send the browser to connect an app: the provider's sign-in page,
 * with a signed state (who, which app, and a nonce that must match a cookie
 * in the same browser).
 */
export function startConnecting(userId: string, provider: Provider, origin: string) {
  const creds = credentialsFor(provider);
  const key = connectionsKey();
  if (!creds || !key)
    throw new Error(`${PROVIDERS[provider].name} isn't set up on this server yet.`);
  const nonce = randomBytes(16).toString("base64url");
  const state = signToken({ u: userId, p: provider, n: nonce }, key, Date.now() + STATE_TTL_MS);
  return {
    url: authorizeUrl(provider, {
      clientId: creds.clientId,
      redirectUri: redirectUri(provider, origin),
      state,
    }),
    nonce,
  };
}

/** Finishes connecting: checks the state, trades the code for tokens, stores them sealed. */
export async function finishConnecting(
  userId: string,
  provider: Provider,
  input: { code: string; state: string; nonce: string | undefined; origin: string; actor: Actor },
) {
  const creds = credentialsFor(provider);
  const key = connectionsKey();
  if (!creds || !key)
    throw new Error(`${PROVIDERS[provider].name} isn't set up on this server yet.`);
  const state = readToken<{ u: string; p: string; n: string }>(input.state, key);
  if (
    !state ||
    state.u !== userId ||
    state.p !== provider ||
    !input.nonce ||
    state.n !== input.nonce
  ) {
    throw new Error("That sign-in link expired or wasn't started here. Try connecting again.");
  }
  const tokens = await exchangeCode(provider, {
    code: input.code,
    redirectUri: redirectUri(provider, input.origin),
    ...creds,
  });
  if (!tokens.accessToken)
    throw new Error(`${PROVIDERS[provider].name} didn't send an access token.`);
  const values = {
    account: tokens.account,
    scopes: tokens.scopes,
    accessToken: seal(tokens.accessToken, key),
    refreshToken: tokens.refreshToken ? seal(tokens.refreshToken, key) : null,
    expiresAt: tokens.expiresAt,
    updatedAt: new Date(),
  };
  await db().transaction(async (tx) => {
    const [row] = await tx
      .insert(appConnections)
      .values({ userId, provider, ...values })
      .onConflictDoUpdate({ target: [appConnections.userId, appConnections.provider], set: values })
      .returning({ id: appConnections.id });
    await audit(
      {
        actor: input.actor,
        action: "connection.added",
        entityType: "connection",
        entityId: row.id,
        details: { provider },
      },
      tx,
    );
  });
  return { account: tokens.account };
}

export async function disconnect(userId: string, provider: Provider, actor: Actor) {
  const key = connectionsKey();
  const [row] = await db()
    .delete(appConnections)
    .where(and(eq(appConnections.userId, userId), eq(appConnections.provider, provider)))
    .returning();
  if (!row) return;
  // Also tell Google to forget the grant; Notion has no revoke call.
  if (provider === "google" && key) {
    const token = unseal(row.refreshToken ?? row.accessToken, key);
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
      method: "POST",
    }).catch(() => {});
  }
  await audit({
    actor,
    action: "connection.removed",
    entityType: "connection",
    entityId: row.id,
    details: { provider },
  });
}

/** A working access token for one of the user's apps, refreshed when it's about to expire. */
export async function accessTokenFor(userId: string, provider: Provider): Promise<string> {
  const key = connectionsKey();
  const creds = credentialsFor(provider);
  if (!key || !creds) throw new Error(`${PROVIDERS[provider].name} isn't set up on this server.`);
  const row = await db().query.appConnections.findFirst({
    where: and(eq(appConnections.userId, userId), eq(appConnections.provider, provider)),
  });
  if (!row) throw new Error(`Connect ${PROVIDERS[provider].name} first.`);
  if (!row.expiresAt || row.expiresAt.getTime() > Date.now() || !row.refreshToken) {
    return unseal(row.accessToken, key);
  }
  const fresh = await refreshAccess(provider, unseal(row.refreshToken, key), creds);
  await db()
    .update(appConnections)
    .set({
      accessToken: seal(fresh.accessToken, key),
      ...(fresh.refreshToken && { refreshToken: seal(fresh.refreshToken, key) }),
      expiresAt: fresh.expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(appConnections.id, row.id));
  return fresh.accessToken;
}

/** How long a send or create waits for the user's OK. */
const CONFIRM_TTL_MS = 15 * 60_000;

export interface AppConfirm {
  /** Signed: who, which tool, what, until when. */
  token: string;
  preview: string;
  app: string;
}

function toolsFor(providers: Provider[]) {
  return TOOLS.filter((t) => providers.includes(t.provider));
}

/**
 * A task in the user's connected apps, asked for in conversation. Reads run
 * now; a send or create comes back as `confirm` for the user to OK.
 */
export async function doAppTask(
  client: ModelClient,
  userId: string,
  input: { goal: string; now: string; offset: OffsetMinutes; name: string; actor: Actor },
): Promise<{ reply: string; confirm: AppConfirm | null; needsConnecting: boolean }> {
  const providers = await connectedProviders(userId);
  const key = connectionsKey();
  if (!providers.length || !key) {
    return {
      reply: "I can do that once you connect your apps. Open My Persuna and choose Connect.",
      confirm: null,
      needsConnecting: true,
    };
  }
  const result = await runAppTask(
    client,
    { name: input.name, goal: input.goal, now: input.now, tools: toolsFor(providers) },
    async (tool, args) => {
      const out = await tool.run(args, {
        token: await accessTokenFor(userId, tool.provider),
        offset: input.offset,
        fetch,
      });
      if (tool.name === "gmail_draft") {
        await audit({
          actor: input.actor,
          action: "app.gmail_draft",
          entityType: "connection",
          details: { provider: tool.provider },
        });
      }
      return out;
    },
  );
  const confirm = result.pending
    ? {
        token: signToken(
          { u: userId, tool: result.pending.tool, args: result.pending.args, o: input.offset },
          key,
          Date.now() + CONFIRM_TTL_MS,
        ),
        preview: result.pending.preview,
        app: PROVIDERS[toolNamed(result.pending.tool)!.provider].name,
      }
    : null;
  return { reply: result.reply, confirm, needsConnecting: false };
}

/** The user said yes: do the send or create they were shown, once. */
export async function confirmAppAction(userId: string, token: string, actor: Actor) {
  const key = connectionsKey();
  const pending =
    key && readToken<{ u: string; tool: string; args: unknown; o: OffsetMinutes }>(token, key);
  if (!pending || pending.u !== userId) throw new Error("That request expired. Ask me again?");
  const tool = toolNamed(pending.tool);
  if (!tool?.writes) throw new Error("That request expired. Ask me again?");
  // Each OK is used once: a repeat within the window is refused.
  if (usedConfirmations.has(token)) throw new Error("That's already done.");
  usedConfirmations.add(token);
  const args = tool.args.parse(pending.args);
  const result = (await tool.run(args, {
    token: await accessTokenFor(userId, tool.provider),
    offset: pending.o,
    fetch,
  })) as { link?: string | null; url?: string | null };
  await audit({
    actor,
    action: `app.${tool.name}`,
    entityType: "connection",
    details: { provider: tool.provider },
  });
  const done: Record<string, string> = {
    gmail_send: "Sent.",
    calendar_create: "It's on your calendar.",
    notion_create_page: "Added to Notion.",
  };
  return { message: done[tool.name] ?? "Done.", href: result.link ?? result.url ?? null };
}

/** OKs already used (kept until the app restarts; each token expires in 15 minutes anyway). */
const usedConfirmations = new Set<string>();
