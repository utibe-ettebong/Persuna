/**
 * Minimal Paystack client: start a checkout, verify it, refund it, and check
 * webhook signatures. Endpoint shapes follow Paystack's OpenAPI spec
 * (PaystackOSS/openapi). Payments are in US dollars; amounts go to and come
 * from Paystack in cents, the currency's minor unit, so nothing is converted.
 * (Charging in USD needs USD enabled on the Paystack account.)
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const API = "https://api.paystack.co";

export const PAYSTACK_CURRENCY = "USD";

const initResponse = z.object({
  status: z.boolean(),
  message: z.string(),
  data: z.object({ authorization_url: z.url(), access_code: z.string(), reference: z.string() }),
});

const verifyResponse = z.object({
  status: z.boolean(),
  data: z.object({
    status: z.string(),
    reference: z.string(),
    amount: z.number(),
    currency: z.string(),
  }),
});

const refundResponse = z.object({ status: z.boolean(), message: z.string() });

export interface PaystackClient {
  initialize(input: {
    email: string;
    /** US cents. */
    amountCents: number;
    reference: string;
    callbackUrl: string;
    metadata?: Record<string, string>;
  }): Promise<{ authorizationUrl: string }>;
  /** The amount is in the currency's minor unit (cents for USD). */
  verify(reference: string): Promise<{ paid: boolean; amountMinor: number; currency: string }>;
  refund(reference: string, note: string): Promise<void>;
}

export function createPaystack(secretKey: string, fetchImpl: typeof fetch = fetch): PaystackClient {
  async function call<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
    const res = await fetchImpl(`${API}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${secretKey}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = (body as { message?: string }).message ?? `HTTP ${res.status}`;
      throw new Error(`Paystack: ${message}`);
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new Error("Paystack returned an unexpected response");
    return parsed.data;
  }

  return {
    async initialize({ email, amountCents, reference, callbackUrl, metadata }) {
      if (!Number.isInteger(amountCents) || amountCents <= 0) {
        throw new Error("Payment amount must be a whole number of cents");
      }
      const res = await call("/transaction/initialize", initResponse, {
        method: "POST",
        body: JSON.stringify({
          email,
          amount: amountCents,
          currency: PAYSTACK_CURRENCY,
          reference,
          callback_url: callbackUrl,
          metadata,
        }),
      });
      return { authorizationUrl: res.data.authorization_url };
    },
    async verify(reference) {
      const res = await call(
        `/transaction/verify/${encodeURIComponent(reference)}`,
        verifyResponse,
      );
      return {
        paid: res.data.status === "success",
        amountMinor: res.data.amount,
        currency: res.data.currency,
      };
    },
    async refund(reference, note) {
      await call("/refund", refundResponse, {
        method: "POST",
        body: JSON.stringify({ transaction: reference, merchant_note: note.slice(0, 200) }),
      });
    },
  };
}

/** Paystack signs webhooks with HMAC-SHA512 of the raw body, keyed with the secret key. */
export function validWebhookSignature(
  rawBody: string,
  signature: string | null,
  secretKey: string,
) {
  if (!signature) return false;
  const expected = createHmac("sha512", secretKey).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const webhookEvent = z.object({
  event: z.string(),
  data: z.object({ reference: z.string(), status: z.string().optional() }).loose(),
});

/**
 * Whether a verified Paystack payment is exactly what was asked for: paid, in
 * US dollars, for the exact number of cents.
 */
export function paymentMatches(
  result: { paid: boolean; amountMinor: number; currency: string },
  expectedCents: number,
): boolean {
  return (
    result.paid &&
    result.currency.toUpperCase() === PAYSTACK_CURRENCY &&
    result.amountMinor === expectedCents
  );
}
