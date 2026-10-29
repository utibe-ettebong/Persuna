import { bearerToken } from "@/lib/agents/rules";
import { agentRunStatus, authenticateAgent } from "@/lib/agents/service";

export const dynamic = "force-dynamic";

/**
 * Polls one run started with this key: GET /api/agents/runs/{jobId}.
 * Output appears once the owner-side trust check approves it; until then
 * the status is "awaiting_review" and the owner sees it under Jobs.
 */
export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const key = await authenticateAgent(bearerToken(request.headers.get("authorization")));
  if (!key) {
    return Response.json(
      { error: "Send a valid agent key: Authorization: Bearer [REDACTED]…" },
      { status: 401 },
    );
  }
  const { jobId } = await params;
  const run = await agentRunStatus(key, jobId);
  if (!run) return Response.json({ error: "No such run for this key" }, { status: 404 });
  return Response.json(run);
}
