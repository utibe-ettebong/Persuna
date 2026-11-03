import { describe, expect, it, vi } from "vitest";
import { renderForSave, saveTextToDrive, saveTextToOneDrive, uploadDriveFile } from "./save";

describe("renderForSave", () => {
  it("renders each format with the right type and extension", async () => {
    const docx = await renderForSave("docx", "Notes", "# Hi");
    expect(docx.ext).toBe("docx");
    expect(docx.mimeType).toContain("wordprocessingml");
    expect(docx.bytes.subarray(0, 2).toString()).toBe("PK");

    const pdf = await renderForSave("pdf", "Notes", "# Hi");
    expect(pdf.ext).toBe("pdf");
    expect(pdf.bytes.subarray(0, 5).toString()).toBe("%PDF-");

    const xlsx = await renderForSave("xlsx", "Prices", "a,b\n1,2");
    expect(xlsx.ext).toBe("xlsx");
    expect(xlsx.bytes.subarray(0, 2).toString()).toBe("PK");

    const md = await renderForSave("md", "Notes", "# Hi");
    expect(md.bytes.toString("utf8")).toBe("# Hi");
  });
});

describe("uploadDriveFile", () => {
  it("posts multipart with metadata and reads back the file", async () => {
    const seen: { url: string; contentType: string; body: string }[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seen.push({
        url: String(url),
        contentType: headers.get("content-type") ?? "",
        body: Buffer.from(init?.body as Uint8Array).toString("utf8"),
      });
      return Response.json({ id: "f1", name: "Notes.docx", webViewLink: "https://drive/x/f1" });
    }) as unknown as typeof fetch;
    const saved = await uploadDriveFile({
      token: "tok",
      name: "Notes.docx",
      bytes: Buffer.from("bytes"),
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      convertTo: "application/vnd.google-apps.document",
      fetchFn,
    });
    expect(saved).toEqual({ id: "f1", name: "Notes.docx", link: "https://drive/x/f1" });
    expect(seen[0].url).toContain("upload/drive/v3/files?uploadType=multipart");
    expect(seen[0].contentType).toContain("multipart/related");
    expect(seen[0].body).toContain("application/vnd.google-apps.document");
  });

  it("surfaces upload errors", async () => {
    const fetchFn = (async () => new Response("no", { status: 403 })) as unknown as typeof fetch;
    await expect(
      uploadDriveFile({
        token: "tok",
        name: "x",
        bytes: Buffer.from("y"),
        mimeType: "text/plain",
        fetchFn,
      }),
    ).rejects.toThrow(/HTTP 403/);
  });
});

describe("saveTextToDrive", () => {
  it("renders and converts a .docx by default", async () => {
    let sent: RequestInit = {};
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      sent = init ?? {};
      return Response.json({ id: "f1", name: "N.docx" });
    });
    await saveTextToDrive({
      token: "tok",
      title: "Notes",
      body: "# Hi",
      format: "docx",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const body = Buffer.from(sent.body as Uint8Array).toString("utf8");
    expect(body).toContain('"name":"Notes.docx"');
    expect(body).toContain("application/vnd.google-apps.document");
  });
});

describe("saveTextToOneDrive", () => {
  it("PUTs the rendered bytes to the drive root", async () => {
    let url = "";
    let init: RequestInit = {};
    const fetchFn = vi.fn(async (u: string, i?: RequestInit) => {
      url = u;
      init = i ?? {};
      return Response.json({ id: "o1", name: "Notes.pdf", webUrl: "https://onedrive/x" });
    });
    const saved = await saveTextToOneDrive({
      token: "tok",
      title: "Notes",
      body: "# Hi",
      format: "pdf",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(saved).toEqual({ id: "o1", name: "Notes.pdf", link: "https://onedrive/x" });
    expect(url).toBe("https://graph.microsoft.com/v1.0/me/drive/root:/Notes.pdf:/content");
    expect(init.method).toBe("PUT");
  });
});
