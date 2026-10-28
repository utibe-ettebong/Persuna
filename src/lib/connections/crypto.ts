import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Small, pure helpers for connected apps: tokens sealed at rest (AES-256-GCM)
 * and signed, expiring tokens for actions that wait for the user's OK. The
 * key is any long secret (CONNECTIONS_KEY); it's hashed to 32 bytes.
 */
const keyOf = (secret: string) => createHash("sha256").update(secret).digest();

export function seal(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyOf(secret), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), body]
    .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
    .join(".");
}

export function unseal(sealed: string, secret: string): string {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || body === undefined) throw new Error("Unreadable token");
  const decipher = createDecipheriv("aes-256-gcm", keyOf(secret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(body, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** A signed token carrying `value` until `expiresAt` (ms). */
export function signToken(value: unknown, secret: string, expiresAt: number): string {
  const payload = Buffer.from(JSON.stringify({ v: value, e: expiresAt })).toString("base64url");
  return `${payload}.${mac(payload, secret)}`;
}

/** The value inside a signed token, or null when it's forged or expired. */
export function readToken<T>(token: string, secret: string, now = Date.now()): T | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(mac(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { v, e } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof e === "number" && e >= now ? (v as T) : null;
  } catch {
    return null;
  }
}

const mac = (payload: string, secret: string) =>
  createHmac("sha256", `${secret}:signed`).update(payload).digest("base64url");
