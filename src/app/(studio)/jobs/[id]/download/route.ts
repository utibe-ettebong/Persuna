import { slugify } from "@/lib/action-state";
import { markdownToDocx } from "@/lib/docs/docx";
import { getJobWithSkill } from "@/lib/jobs/service";
import { NotFoundError } from "@/lib/skill/service";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Delivers an approved job as .docx or .md. Drafts that weren't approved never leave. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });

  let row;
  try {
    row = await getJobWithSkill(id);
  } catch (error) {
    if (error instanceof NotFoundError) return new Response("Not found", { status: 404 });
    throw error;
  }
  const { job, skill } = row;
  if (job.status !== "approved" || !job.finalOutput) {
    return new Response("Only approved jobs can be downloaded", { status: 409 });
  }

  const format = new URL(request.url).searchParams.get("format") === "md" ? "md" : "docx";
  const name = `${slugify(skill.name)}-${job.createdAt.toISOString().slice(0, 10)}`;
  const headers = (type: string, ext: string) => ({
    "content-type": type,
    "content-disposition": `attachment; filename="${name}.${ext}"`,
    "cache-control": "private, no-store",
  });

  if (format === "md") {
    return new Response(job.finalOutput, {
      headers: headers("text/markdown; charset=utf-8", "md"),
    });
  }
  const buffer = await markdownToDocx(job.finalOutput, skill.name);
  return new Response(new Uint8Array(buffer), {
    headers: headers(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "docx",
    ),
  });
}
