/**
 * Escrow state changes, independent of how the money moved. Mock payments
 * only change the ledger; Paystack payments also call Paystack.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { paystackConfig } from "@/env";
import { audit, type Actor } from "@/lib/audit";
import { createPaystack } from "./paystack";

const { transactions } = schema;

/** Refunds a job's payment if it is still pending or held. Safe to call when there is none. */
export async function refundForJob(jobId: string, note: string, actor: Actor) {
  const txn = await db().query.transactions.findFirst({
    where: and(eq(transactions.jobId, jobId), inArray(transactions.status, ["pending", "held"])),
  });
  if (!txn) return null;

  if (txn.provider === "paystack" && txn.status === "held" && txn.providerReference) {
    const config = paystackConfig();
    if (!config) throw new Error("This payment was made with Paystack, which is not configured");
    await createPaystack(config.secretKey).refund(txn.providerReference, note);
  }
  await db()
    .update(transactions)
    .set({ status: "refunded", settledAt: new Date() })
    .where(eq(transactions.id, txn.id));
  await audit({
    actor,
    action: "payment.refunded",
    entityType: "transaction",
    entityId: txn.id,
    details: {
      jobId,
      amountCents: txn.amountCents,
      currency: txn.currency,
      provider: txn.provider,
      note: note.slice(0, 120),
    },
  });
  return txn;
}
