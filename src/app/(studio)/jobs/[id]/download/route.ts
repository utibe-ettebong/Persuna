import { slugify } from "@/lib/action-state";
import { assertOrderAccess } from "@/lib/auth/access";
import { getUser } from "@/lib/auth/session";
import { looksLikeCsv } from "@/lib/docs/csv";
import { markdownToDocx } from "@/lib/docs/docx";
import { markdownToPdf } from "@/lib/docs/pdf";
import { markdownToSlides } from "@/lib/docs/pptx";
import { csvToXlsx } from "@/lib/docs/xlsx";
import { getJobWithSkill } from "@/lib/jobs/service";
import { NotFoundError } from "@/lib/skill/service";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Delivers an approved job as .docx, .pdf, .pptx, .xlsx or .md. Drafts that weren't approved never leave. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });

  let row;
  try {
    const user = await getUser();
    if (!user) return new Response("Sign in first", { status: 401 });
    await assertOrderAccess(user, id); // the skill owner, or the renter who ordered it
    row = await getJobWithSkill(id);
  } catch (error) {
    if (error instanceof NotFoundError) return new Response("Not found", { status: 404 });
    throw error;
  }
  const { job, skill } = row;
  if (job.status !== "approved" || !job.finalOutput) {
    return new Response("Only approved jobs can be downloaded", { status: 409 });
  }

  const format = new URL(request.url).searchParams.get("format") ?? "docx";
  const name = `${slugify(skill.name)}-${job.createdAt.toISOString().slice(0, 10)}`;
  const headers = (type: string, ext: string) => ({
    "content-type": type,
    "content-disposition": `attachment; filename="${name}.${ext}"`,
    "cache-control": "private, no-store",
  });
  const file = (buffer: Buffer, type: string, ext: string) =>
    new Response(new Uint8Array(buffer), { headers: headers(type, ext) });

  if (format === "md") {
    return new Response(job.finalOutput, {
      headers: headers("text/markdown; charset=utf-8", "md"),
    });
  }
  if (format === "pdf") {
    return file(await markdownToPdf(job.finalOutput, skill.name), "application/pdf", "pdf");
  }
  if (format === "pptx") {
    return file(
      await markdownToSlides(job.finalOutput, skill.name),
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "pptx",
    );
  }
  if (format === "xlsx") {
    if (!looksLikeCsv(job.finalOutput)) {
      return new Response("Only table outputs download as .xlsx", { status: 409 });
    }
    return file(
      await csvToXlsx(job.finalOutput, skill.name),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "xlsx",
    );
  }
  return file(
    await markdownToDocx(job.finalOutput, skill.name),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "docx",
  );
}
