import { env, modelConfig, modelProvider, type ModelRoleConfig } from "@/env";

/**
 * The provider's Files API (Meta's at api.meta.ai, or any OpenAI-compatible
 * one): upload a document so a model can read it, then delete it. Used to
 * read PDFs; uploads are removed as soon as they've been read.
 */
export interface FileStore {
  upload(data: Blob, filename: string): Promise<string>;
  remove(fileId: string): Promise<void>;
}

/** The EXTRACT provider's Files API, or null with the offline mock. */
export function createFileStore(
  resolve: () => ModelRoleConfig = () => modelConfig("extract"),
  fetchImpl: typeof fetch = fetch,
): FileStore | null {
  if (modelProvider() === "mock") return null;
  return {
    async upload(data, filename) {
      const config = resolve();
      const form = new FormData();
      form.append("purpose", "user_data");
      form.append("file", data, filename);
      const res = await fetchImpl(`${config.baseUrl.replace(/\/+$/, "")}/files`, {
        method: "POST",
        headers: { authorization: `Bearer ${config.apiKey}` },
        body: form,
        signal: AbortSignal.timeout(env().MODEL_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new Error(`Upload failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      }
      const body = (await res.json()) as { id?: unknown };
      if (typeof body.id !== "string") throw new Error("Upload returned no file id");
      return body.id;
    },
    async remove(fileId) {
      const config = resolve();
      await fetchImpl(`${config.baseUrl.replace(/\/+$/, "")}/files/${encodeURIComponent(fileId)}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${config.apiKey}` },
        signal: AbortSignal.timeout(30_000),
      }).catch(() => {});
    },
  };
}
