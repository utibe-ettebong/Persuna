/**
 * The apps Persuna can connect to, and their OAuth details. Pure except for
 * the token calls, which take a fetch so they can be tested.
 */
/** Pinned Meta Graph API version (verified against Meta's changelog). */
export const META_GRAPH_VERSION = "v24.0";

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
  },
  google: {
    name: "Google",
    apps: "Gmail and Google Calendar",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "openid",
      "email",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.compose",
      "https://www.googleapis.com/auth/calendar.events",
    ],
    // A refresh token, so Persuna keeps working after the first hour.
    extra: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
  },
  notion: {
    name: "Notion",
    apps: "Notion",
    authorizeUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    scopes: [] as string[],
    extra: { owner: "user" },
  },
} as const;

export type Provider = keyof typeof PROVIDERS;
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
  input: { clientId: string; redirectUri: string; state: string },
): string {
  const p = PROVIDERS[provider];
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    state: input.state,
    // Meta takes its permissions comma-separated; Google space-separated.
    ...(p.scopes.length && { scope: p.scopes.join(provider === "meta" ? "," : " ") }),
    ...p.extra,
  });
  return `${p.authorizeUrl}?${params}`;
}

const expiry = (seconds: unknown) =>
  typeof seconds === "number" ? new Date(Date.now() + (seconds - 60) * 1000) : null;

async function readJson(res: Response, what: string) {
  if (!res.ok) throw new Error(`${what} failed: HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

/** Trades the code from the sign-in page for tokens, and finds which account it is. */
export async function exchangeCode(
  provider: Provider,
  input: { code: string; redirectUri: string } & ClientCredentials,
  fetchImpl: typeof fetch = fetch,
): Promise<Tokens> {
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
    provider === "google"
      ? await fetchImpl(PROVIDERS.google.tokenUrl, {
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
