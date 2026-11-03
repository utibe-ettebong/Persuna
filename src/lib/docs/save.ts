/**
 * Saving rendered files to the renter's cloud drives: Google Drive (as
 * editable Docs, Sheets or Slides when converted) and OneDrive. Takes a
 * token, so the connected-app tools, the jobs runner and the milestone
 * flow all share it.
 */
import { markdownToDocx } from "./docx";
import { markdownToPdf } from "./pdf";
import { markdownToSlides } from "./pptx";
import { csvToXlsx } from "./xlsx";

export type SaveFormat = "md" | "docx" | "pdf" | "pptx" | "xlsx";

export interface SavedFile {
  id: string | null;
  name: string;
  link: string | null;
}

const MIME: Record<SaveFormat, string> = {
  md: "text/markdown",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** Google editors' MIME types, for uploads that should open editable. */
const GOOGLE_MIME: Partial<Record<SaveFormat, string>> = {
  docx: "application/vnd.google-apps.document",
  pptx: "application/vnd.google-apps.presentation",
  xlsx: "application/vnd.google-apps.spreadsheet",
};

/** Render body text (Markdown, or CSV for xlsx) to bytes. */
export async function renderForSave(
  format: SaveFormat,
  title: string,
  body: string,
): Promise<{ bytes: Buffer; mimeType: string; ext: string }> {
  switch (format) {
    case "docx":
      return { bytes: await markdownToDocx(body, title), mimeType: MIME.docx, ext: "docx" };
    case "pdf":
      return { bytes: await markdownToPdf(body, title), mimeType: MIME.pdf, ext: "pdf" };
    case "pptx":
      return { bytes: await markdownToSlides(body, title), mimeType: MIME.pptx, ext: "pptx" };
    case "xlsx":
      return { bytes: await csvToXlsx(body, title), mimeType: MIME.xlsx, ext: "xlsx" };
    default:
      return { bytes: Buffer.from(body, "utf8"), mimeType: MIME.md, ext: "md" };
  }
}

export interface UploadInput {
  token: string;
  name: string;
  bytes: Buffer;
  mimeType: string;
  fetchFn?: typeof fetch;
}

/** Multipart upload to Drive; with a convert target it opens as an editable Google file. */
export async function uploadDriveFile(
  input: UploadInput & { convertTo?: string },
): Promise<SavedFile> {
  const boundary = `persuna-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const metadata = JSON.stringify({
    name: input.name,
    ...(input.convertTo && { mimeType: input.convertTo }),
  });
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\ncontent-type: application/json; charset=utf-8\r\n\r\n${metadata}\r\n--${boundary}\r\ncontent-type: ${input.mimeType}\r\n\r\n`,
      "utf8",
    ),
    input.bytes,
    Buffer.from(`\r\n--${boundary}--`, "utf8"),
  ]);
  const res = await (input.fetchFn ?? fetch)(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.token}`,
        "content-type": `multipart/related; boundary=${boundary}`,
      },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!res.ok) throw new Error(`Drive upload failed: HTTP ${res.status}`);
  const data = (await res.json()) as Record<string, unknown>;
  return {
    id: typeof data.id === "string" ? data.id : null,
    name: typeof data.name === "string" ? data.name : input.name,
    link: typeof data.webViewLink === "string" ? data.webViewLink : null,
  };
}

/** Simple upload to the user's OneDrive root (files under 4 MB). */
export async function uploadOneDriveFile(input: UploadInput): Promise<SavedFile> {
  if (input.bytes.length > 4_000_000) {
    throw new Error("That file is too big for a direct upload (4 MB).");
  }
  const res = await (input.fetchFn ?? fetch)(
    `https://graph.microsoft.com/v1.0/me/drive/root:/${encodeURIComponent(input.name)}:/content`,
    {
      method: "PUT",
      headers: { authorization: `Bearer ${input.token}`, "content-type": input.mimeType },
      body: new Uint8Array(input.bytes),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!res.ok) throw new Error(`OneDrive upload failed: HTTP ${res.status}`);
  const data = (await res.json()) as Record<string, unknown>;
  return {
    id: typeof data.id === "string" ? data.id : null,
    name: typeof data.name === "string" ? data.name : input.name,
    link: typeof data.webUrl === "string" ? data.webUrl : null,
  };
}

export interface SaveTextInput {
  token: string;
  title: string;
  body: string;
  format: SaveFormat;
  convert?: boolean;
  fetchFn?: typeof fetch;
}

/** Render text and save it to Drive, converting Office formats to Google files. */
export async function saveTextToDrive(input: SaveTextInput): Promise<SavedFile> {
  const { bytes, mimeType, ext } = await renderForSave(input.format, input.title, input.body);
  const convertTo = input.convert === false ? undefined : GOOGLE_MIME[input.format];
  return uploadDriveFile({
    token: input.token,
    name: `${input.title}.${ext}`,
    bytes,
    mimeType,
    fetchFn: input.fetchFn,
    ...(convertTo && { convertTo }),
  });
}

/** Render text and save it to OneDrive. */
export async function saveTextToOneDrive(input: SaveTextInput): Promise<SavedFile> {
  const { bytes, mimeType, ext } = await renderForSave(input.format, input.title, input.body);
  return uploadOneDriveFile({
    token: input.token,
    name: `${input.title}.${ext}`,
    bytes,
    mimeType,
    fetchFn: input.fetchFn,
  });
}
