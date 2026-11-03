/**
 * The apps Persuna can connect to, and their OAuth details. Pure except for
 * the token calls, which take a fetch so they can be tested.
 */
import { createHash, randomBytes } from "node:crypto";

/** Pinned Meta Graph API version (verified against Meta's changelog). */
export const META_GRAPH_VERSION = "v24.0";

export const X_API = "https://api.x.com/2";

export const PROVIDERS = {
  meta: {
    name: "Meta",
    apps: "Facebook Pages and Instagram",
    authorizeUrl: `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`,
    tokenUrl: `https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`,
    scopes: [
      "pages_show_list",
      "pages_read_engagement",
      "pages_manage_posts",
      "instagram_business_basic",
    ],
    extra: {},
    manual: false,
  },
  x: {
    name: "X",
    apps: "Posts and mentions",
    authorizeUrl: "https://x.com/i/oauth2/authorize",
    tokenUrl: `${X_API}/oauth2/token`,
    scopes: ["tweet.read", "tweet.write", "users.read", "offline.access"],
    extra: {},
    manual: false,
  },
  google: {
    name: "Google",
    apps: "Gmail, Calendar, Drive, Docs, Sheets and Slides",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "openid",
      "email",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.compose",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/documents",
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/presentations",
    ],
    // A refresh token, so Persuna keeps working after the first hour.
    extra: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
    manual: false,
  },
  notion: {
    name: "Notion",
    apps: "Notion",
    authorizeUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    scopes: [] as string[],
    extra: { owner: "user" },
    manual: false,
  },
  microsoft: {
    name: "Microsoft",
    apps: "OneDrive, Outlook, Excel and Teams",
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2/token",
    scopes: [
      "openid",
      "email",
      "offline_access",
      "Files.ReadWrite",
      "Mail.Read",
      "Mail.Send",
      "Team.ReadBasic.All",
      "ChannelMessage.Send",
    ],
    extra: { response_mode: "query" },
    manual: false,
  },
  shopify: {
    name: "Shopify",
    apps: "Shopify stores",
    authorizeUrl: "",
    tokenUrl: "",
    scopes: [] as string[],
    extra: {},
    manual: true,
  },
  mailchimp: {
    name: "Mailchimp",
    apps: "Mailchimp audiences",
    authorizeUrl: "",
    tokenUrl: "",
    scopes: [] as string[],
    extra: {},
    manual: true,
  },
} as const;

export type Provider = keyof typeof PROVIDERS;

/** Providers connected by pasting an API token, not OAuth. */
export const isManualProvider = (provider: Provider): boolean =>
  PROVIDERS[provider].manual === true;
export const PROVIDER_IDS = Object.keys(PROVIDERS) as Provider[];
export const isProvider = (value: string): value is Provider => value in PROVIDERS;

export interface ClientCredentials {
  clientId: string;
  clientSecret: string;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  account: string;
  scopes: string;
}

export function authorizeUrl(
  provider: Provider,
  input: { clientId: string; redirectUri: string; state: string; codeChallenge?: string },
): string {
  const p = PROVIDERS[provider];
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    state: input.state,
    // Meta takes its permissions comma-separated; Google and X space-separated.
    ...(p.scopes.length && { scope: p.scopes.join(provider === "meta" ? "," : " ") }),
    // X requires PKCE: the challenge goes here, the verifier at the exchange.
    ...(input.codeChallenge && {
      code_challenge: input.codeChallenge,
      code_challenge_method: "S256",
    }),
    ...p.extra,
  });
  return `${p.authorizeUrl}?${params}`;
}

/** A PKCE pair for providers that require it (X): random verifier, S256 challenge. */
export function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(64).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

const expiry = (seconds: unknown) =>
  typeof seconds === "number" ? new Date(Date.now() + (seconds - 60) * 1000) : null;

/** Email from an id_token, for the account label (over TLS; display only). */
function idTokenEmail(idToken: unknown): string | null {
  if (typeof idToken !== "string") return null;
  try {
    const payload = JSON.parse(
      Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    const email = payload.email ?? payload.preferred_username;
    return typeof email === "string" && email ? email : null;
  } catch {
    return null;
  }
}

async function readJson(res: Response, what: string) {
  if (!res.ok) throw new Error(`${what} failed: HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

/** Trades the code from the sign-in page for tokens, and finds which account it is. */
export async function exchangeCode(
  provider: Provider,
  input: { code: string; redirectUri: string; codeVerifier?: string } & ClientCredentials,
  fetchImpl: typeof fetch = fetch,
): Promise<Tokens> {
  if (isManualProvider(provider)) {
    throw new Error(`${PROVIDERS[provider].name} connects with an API token, not a sign-in.`);
  }
  if (provider === "x") {
    if (!input.codeVerifier)
      throw new Error("X sign-in needs its PKCE verifier. Try connecting again.");
    const data = await readJson(
      await fetchImpl(PROVIDERS.x.tokenUrl, {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${input.clientId}:${input.clientSecret}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: input.code,
          redirect_uri: input.redirectUri,
          code_verifier: input.codeVerifier,
        }),
      }),
      "X sign-in",
    );
    const accessToken = String(data.access_token ?? "");
    const me = (await readJson(
      await fetchImpl(`${X_API}/users/me`, {
        headers: { authorization: `Bearer ${accessToken}` },
      }),
      "X account lookup",
    )) as { data?: { username?: string } };
    const username = String(me.data?.username ?? "");
    return {
      accessToken,
      refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : null,
      expiresAt: expiry(data.expires_in),
      account: username ? `@${username}` : "X account",
      scopes: PROVIDERS.x.scopes.join(" "),
    };
  }
  if (provider === "meta") {
    const query = (params: Record<string, string>) =>
      `${PROVIDERS.meta.tokenUrl}?${new URLSearchParams(params)}`;
    const short = await readJson(
      await fetchImpl(
        query({
          client_id: input.clientId,
          client_secret: input.clientSecret,
          redirect_uri: input.redirectUri,
          code: input.code,
        }),
      ),
      "Meta sign-in",
    );
    // A code gives an hour-long token; exchanging it gives ~60 days.
    const long = await readJson(
      await fetchImpl(
        query({
          grant_type: "fb_exchange_token",
          client_id: input.clientId,
          client_secret: input.clientSecret,
          fb_exchange_token: String(short.access_token ?? ""),
        }),
      ),
      "Meta sign-in",
    );
    const accessToken = String(long.access_token ?? "");
    const me = await readJson(
      await fetchImpl(
        `https://graph.facebook.com/${META_GRAPH_VERSION}/me?fields=name&access_token=${encodeURIComponent(accessToken)}`,
      ),
      "Meta account lookup",
    );
    return {
      accessToken,
      // Meta has no refresh tokens: re-exchanging the long-lived token extends
      // it, so it doubles as the refresh credential (see refreshAccess).
      refreshToken: accessToken || null,
      expiresAt: expiry(long.expires_in),
      account: String(me.name ?? "Meta account"),
      scopes: PROVIDERS.meta.scopes.join(","),
    };
  }
  if (provider === "google") {
    const data = await readJson(
      await fetchImpl(PROVIDERS.google.tokenUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: input.code,
          client_id: input.clientId,
          client_secret: input.clientSecret,
          redirect_uri: input.redirectUri,
          grant_type: "authorization_code",
        }),
      }),
      "Google sign-in",
    );
    const accessToken = String(data.access_token ?? "");
    const me = await readJson(
      await fetchImpl("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { authorization: `Bearer ${accessToken}` },
      }),
      "Google account lookup",
    );
    return {
      accessToken,
      refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : null,
      expiresAt: expiry(data.expires_in),
      account: String(me.email ?? "Google account"),
      scopes: String(data.scope ?? ""),
    };
  }
  if (provider === "microsoft") {
    const data = await readJson(
      await fetchImpl(PROVIDERS.microsoft.tokenUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: input.code,
          client_id: input.clientId,
          client_secret: input.clientSecret,
          redirect_uri: input.redirectUri,
          grant_type: "authorization_code",
        }),
      }),
      "Microsoft sign-in",
    );
    return {
      accessToken: String(data.access_token ?? ""),
      refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : null,
      expiresAt: expiry(data.expires_in),
      account: idTokenEmail(data.id_token) ?? "Microsoft account",
      scopes: String(data.scope ?? PROVIDERS.microsoft.scopes.join(" ")),
    };
  }
  const data = await readJson(
    await fetchImpl(PROVIDERS.notion.tokenUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Basic ${Buffer.from(`${input.clientId}:${input.clientSecret}`).toString("base64")}`,
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: input.redirectUri,
      }),
    }),
    "Notion sign-in",
  );
  return {
    accessToken: String(data.access_token ?? ""),
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : null,
    expiresAt: expiry(data.expires_in),
    account: String(data.workspace_name ?? "Notion workspace"),
    scopes: "",
  };
}

/** A fresh access token from a refresh token. */
export async function refreshAccess(
  provider: Provider,
  refreshToken: string,
  creds: ClientCredentials,
  fetchImpl: typeof fetch = fetch,
): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: Date | null }> {
  if (isManualProvider(provider)) {
    throw new Error(`${PROVIDERS[provider].name} tokens don't refresh; paste a new one.`);
  }
  if (provider === "x") {
    // X rotates refresh tokens: the response carries the next one.
    const data = await readJson(
      await fetchImpl(PROVIDERS.x.tokenUrl, {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
      }),
      "X refresh",
    );
    return {
      accessToken: String(data.access_token ?? ""),
      refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : null,
      expiresAt: expiry(data.expires_in),
    };
  }
  if (provider === "meta") {
    // Re-exchanging a live long-lived token extends it another ~60 days; an
    // expired one fails here and the user reconnects.
    const data = await readJson(
      await fetchImpl(
        `${PROVIDERS.meta.tokenUrl}?${new URLSearchParams({
          grant_type: "fb_exchange_token",
          client_id: creds.clientId,
          client_secret: creds.clientSecret,
          fb_exchange_token: refreshToken,
        })}`,
      ),
      "Meta refresh",
    );
    const accessToken = String(data.access_token ?? "");
    return { accessToken, refreshToken: accessToken || null, expiresAt: expiry(data.expires_in) };
  }
  const res =
    provider === "google" || provider === "microsoft"
      ? await fetchImpl(PROVIDERS[provider].tokenUrl, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            refresh_token: refreshToken,
            client_id: creds.clientId,
            client_secret: creds.clientSecret,
            grant_type: "refresh_token",
          }),
        })
      : await fetchImpl(PROVIDERS.notion.tokenUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64")}`,
          },
          body: JSON.stringify({ grant_type: "refresh_token", refresh_token: refreshToken }),
        });
  const data = await readJson(res, `${PROVIDERS[provider].name} refresh`);
  return {
    accessToken: String(data.access_token ?? ""),
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : null,
    expiresAt: expiry(data.expires_in),
  };
}
