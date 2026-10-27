import { redirect } from "next/navigation";
import { confirmPayment } from "@/lib/market/service";
import { createModelClient } from "@/lib/models";

export const dynamic = "force-dynamic";

/**
 * Paystack sends the renter back here after checkout with ?reference=.
 * The payment is verified with Paystack (never trusted from the URL) and the
 * job is drafted. The webhook does the same if the renter never returns.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const reference = new URL(request.url).searchParams.get("reference");
  if (!reference || reference !== `persuna-${id}`) {
    return new Response("Missing or mismatched payment reference", { status: 400 });
  }
  try {
    await confirmPayment(createModelClient(), reference);
  } catch (error) {
    console.error("Payment confirmation failed:", error);
    redirect(`/market/orders/${id}?payment=unconfirmed`);
  }
  redirect(`/market/orders/${id}`);
}
