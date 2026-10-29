import { paystackConfig } from "@/env";
import { confirmPayment } from "@/lib/market/service";
import { createModelClient } from "@/lib/models";
import { confirmMilestonePayment } from "@/lib/projects/service";
import { validWebhookSignature, webhookEvent } from "@/lib/payments/paystack";

export const dynamic = "force-dynamic";

/**
 * Paystack webhook. Point your Paystack dashboard at {APP_URL}/api/webhooks/paystack.
 * Requests are trusted only with a valid signature, and the payment is still
 * re-verified with Paystack's API before anything changes.
 */
export async function POST(request: Request) {
  const config = paystackConfig();
  if (!config) return new Response("Paystack is not configured", { status: 404 });

  const raw = await request.text();
  if (!validWebhookSignature(raw, request.headers.get("x-paystack-signature"), config.secretKey)) {
    return new Response("Invalid signature", { status: 401 });
  }
  const parsed = webhookEvent.safeParse(JSON.parse(raw));
  if (!parsed.success) return new Response("Ignored", { status: 200 });

  const reference = parsed.data.data.reference;
  if (parsed.data.event === "charge.success" && reference.startsWith("persuna-")) {
    try {
      // persuna-ms-… is a project milestone; persuna-<job id> is a rental.
      if (reference.startsWith("persuna-ms-")) await confirmMilestonePayment(reference);
      else await confirmPayment(createModelClient(), reference);
    } catch (error) {
      console.error("Webhook confirmation failed:", error);
      // 500 makes Paystack retry later.
      return new Response("Not processed", { status: 500 });
    }
  }
  return new Response("OK", { status: 200 });
}
