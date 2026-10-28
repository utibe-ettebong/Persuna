import type { ModelClient } from "@/lib/models/gateway";
import type { FileStore } from "@/lib/models/files";
import { transcribeDocument } from "@/lib/skill/engine";
import { readUploadedText } from "./read-file";

/** PDFs, scans and photos, read by the model. Up to 20 MB. */
export const DOCUMENT_TYPES = /\.(pdf|png|jpe?g|webp)$/i;
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const TASK_FILE_ACCEPT = ".md,.markdown,.txt,.docx,.pdf,.png,.jpg,.jpeg,.webp";

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/**
 * A task's input from an uploaded file: text files as they are, and PDFs,
 * scans and photos transcribed page by page by the model. Pages are marked
 * "[file · page n]" so a draft's quotes can be traced back. PDFs go through
 * the provider's Files API and are deleted from it straight after.
 * Returns null when no file was chosen.
 */
export async function readTaskInput(
  value: FormDataEntryValue | null,
  client: ModelClient,
  files: FileStore | null,
): Promise<string | null> {
  if (!(value instanceof File) || value.size === 0) return null;
  if (!DOCUMENT_TYPES.test(value.name)) return readUploadedText(value);
  if (value.size > MAX_DOCUMENT_BYTES) throw new Error(`${value.name} is larger than 20 MB`);

  const ext = value.name.split(".").pop()!.toLowerCase();
  const bytes = Buffer.from(await value.arrayBuffer());
  let pages: { page: number; text: string }[];
  if (ext === "pdf") {
    if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      throw new Error(`${value.name} isn't a readable PDF`);
    }
    if (!files) {
      // Offline mock: no Files API, so the mock model "reads" it by name.
      pages = await transcribeDocument(client, value.name, { type: "text", text: "(PDF)" });
    } else {
      const fileId = await files.upload(new Blob([bytes], { type: "application/pdf" }), value.name);
      try {
        pages = await transcribeDocument(client, value.name, {
          type: "file",
          file: { file_id: fileId, filename: value.name },
        });
      } finally {
        await files.remove(fileId);
      }
    }
  } else {
    const url = `data:${IMAGE_MIME[ext]};base64,${bytes.toString("base64")}`;
    pages = await transcribeDocument(client, value.name, { type: "image_url", image_url: { url } });
  }
  if (!pages.length) throw new Error(`No readable text in ${value.name}`);
  return pages.map((p) => `[${value.name} · page ${p.page}]\n${p.text.trim()}`).join("\n\n");
}
