import { redirect } from "next/navigation";
import { confirmMilestonePayment, projectIdOfMilestone } from "@/lib/projects/service";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Paystack sends the poster back here after paying a milestone, with
 * ?reference=. The payment is verified with Paystack (never trusted from the
 * URL) before the milestone counts as funded. The webhook does the same.
 */
export async function GET(request: Request, { params }: { params: Promise<{ mid: string }> }) {
  const { mid } = await params;
  const reference = new URL(request.url).searchParams.get("reference");
  if (!UUID.test(mid) || !reference || !reference.startsWith(`persuna-ms-${mid}-`)) {
    return new Response("Missing or mismatched payment reference", { status: 400 });
  }
  let projectId: string;
  try {
    projectId = await projectIdOfMilestone(mid);
  } catch {
    return new Response("No such milestone", { status: 404 });
  }
  try {
    await confirmMilestonePayment(reference);
  } catch (error) {
    console.error("Milestone payment confirmation failed:", error);
    redirect(`/projects/${projectId}?payment=unconfirmed`);
  }
  redirect(`/projects/${projectId}`);
}
