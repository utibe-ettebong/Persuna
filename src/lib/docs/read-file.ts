import mammoth from "mammoth";

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const TEXT_TYPES = /\.(md|markdown|txt)$/i;

/** Text from an uploaded .md, .txt or .docx file. Returns null when no file was chosen. */
export async function readUploadedText(file: FormDataEntryValue | null): Promise<string | null> {
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > MAX_UPLOAD_BYTES) throw new Error(`${file.name} is larger than 2 MB`);

  if (/\.docx$/i.test(file.name)) {
    const { value } = await mammoth.extractRawText({
      buffer: Buffer.from(await file.arrayBuffer()),
    });
    return value.trim();
  }
  if (TEXT_TYPES.test(file.name)) return (await file.text()).trim();
  throw new Error(`${file.name}: upload a .md, .txt or .docx file`);
}
