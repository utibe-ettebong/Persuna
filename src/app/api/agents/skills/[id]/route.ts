import { after } from "next/server";
import { bearerToken } from "@/lib/agents/rules";
import { authenticateAgent, importStatusForKey, processImport } from "@/lib/agents/service";
import { NotFoundError } from "@/lib/skill/service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where an import the agent sent has got to: status and report (counts and score only). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const key = await authenticateAgent(bearerToken(request.headers.get("authorization")));
  if (!key) return Response.json({ error: "Send a valid agent key" }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return Response.json({ error: "No such import" }, { status: 404 });
  try {
    const status = await importStatusForKey(key, id);
    // Picks up an import whose run was interrupted (e.g. by a restart); a no-op otherwise.
    if (status.status !== "verified" && status.status !== "failed") {
      after(async () => {
        await processImport(id).catch((e) => console.error("Agent import failed:", e));
      });
    }
    return Response.json(status);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return Response.json({ error: "No such import" }, { status: 404 });
    }
    throw error;
  }
}
