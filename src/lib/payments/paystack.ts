/**
 * Minimal Paystack client: start a checkout, verify it, refund it, and check
 * webhook signatures. Endpoint shapes follow Paystack's OpenAPI spec
 * (PaystackOSS/openapi). Amounts go to Paystack in kobo.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const API = "https://api.paystack.co";

export const toKobo = (naira: number) => Math.round(naira * 100);

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
    amountNgn: number;
    reference: string;
    callbackUrl: string;
    metadata?: Record<string, string>;
  }): Promise<{ authorizationUrl: string }>;
  verify(reference: string): Promise<{ paid: boolean; amountNgn: number; currency: string }>;
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
    async initialize({ email, amountNgn, reference, callbackUrl, metadata }) {
      const res = await call("/transaction/initialize", initResponse, {
        method: "POST",
        body: JSON.stringify({
          email,
          amount: toKobo(amountNgn),
          currency: "NGN",
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
        amountNgn: res.data.amount / 100,
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
