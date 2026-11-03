import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/auth/session";
import { renderForSave, type SaveFormat } from "@/lib/docs/save";

const renderInput = z.object({
  kind: z.enum(["document", "table"]),
  title: z.string().trim().min(1).max(120),
  body: z.string().max(200_000),
  format: z.enum(["docx", "xlsx", "pdf", "pptx"]),
});

/** Renders a chat file Persuna made to an Office format, for download. */
export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const parsed = renderInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid file." }, { status: 400 });
  const { title, body, format } = parsed.data;
  try {
    const { bytes, mimeType, ext } = await renderForSave(format as SaveFormat, title, body);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": mimeType,
        "content-disposition": `attachment; filename="${title}.${ext}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Couldn't render that file." }, { status: 400 });
  }
}
