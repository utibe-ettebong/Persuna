"use client";

import { useRef, useState } from "react";
import { Markdown } from "@/components/markdown";
import { flowSvg } from "@/lib/persuna/flow-layout";
import type { MadeFile } from "@/lib/persuna/service";
import { FlowDiagram } from "./screen-drawing";

type Saver = {
  saveFile?(file: { name: string; ext: string; data: string }): Promise<string | null>;
  savePdf?(doc: { name: string; html: string }): Promise<string | null>;
};

/** Rows of a CSV table (quoted cells may hold commas and quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows.filter((r) => r.some((c) => c.trim()));
}

const PRINT_CSS = `body{font:14px/1.55 -apple-system,"Segoe UI",sans-serif;color:#1d161d;margin:48px;}h1,h2,h3{line-height:1.25;margin:1.2em 0 .4em}h1{font-size:24px}h2{font-size:18px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px 8px;text-align:left}ul,ol{padding-left:22px}`;

/** Downloads a file in the browser (the web companion; the desktop app saves to Downloads). */
function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function svgToPng(svg: string): Promise<string> {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth * 2;
  canvas.height = img.naturalHeight * 2;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(2, 2);
  ctx.drawImage(img, 0, 0);
  return canvas.toDataURL("image/png").split(",")[1];
}

/**
 * A file Persuna made: a document, a table or a diagram. Preview it, copy it,
 * or save it (PDF or Markdown, CSV, SVG or PNG).
 */
export function MadeFileCard({
  file,
  onClose,
  onCopy,
  desktop,
}: {
  file: MadeFile;
  onClose: () => void;
  onCopy: (text: string) => void;
  desktop: Saver | null;
}) {
  const preview = useRef<HTMLDivElement | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [open, setOpen] = useState(true);

  async function save(ext: "pdf" | "md" | "csv" | "svg" | "png") {
    setSaved(null);
    const name = file.title;
    if (ext === "pdf") {
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>${name.replace(/</g, "&lt;")}</title><style>${PRINT_CSS}</style></head><body>${preview.current?.innerHTML ?? ""}</body></html>`;
      if (desktop?.savePdf) return setSaved(await desktop.savePdf({ name, html }));
      // In a browser: its print dialog saves PDFs.
      const w = window.open("", "_blank");
      if (!w) return;
      w.document.write(html);
      w.document.close();
      w.focus();
      w.print();
      return;
    }
    const svg = file.flow ? flowSvg(file.flow, file.title) : "";
    const data = ext === "svg" ? svg : ext === "png" ? await svgToPng(svg) : file.body;
    if (desktop?.saveFile) return setSaved(await desktop.saveFile({ name, ext, data }));
    const type = { md: "text/markdown", csv: "text/csv", svg: "image/svg+xml", png: "image/png" }[
      ext
    ];
    const blob =
      ext === "png"
        ? new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], { type })
        : new Blob([data], { type });
    download(`${name}.${ext}`, blob);
  }

  const formats: ("pdf" | "md" | "csv" | "svg" | "png")[] =
    file.kind === "document"
      ? ["pdf", "md"]
      : file.kind === "table"
        ? ["csv", "pdf"]
        : ["png", "svg"];
  const rows = file.kind === "table" ? parseCsv(file.body) : [];

  return (
    <div className="persuna-in space-y-3 rounded-[24px] bg-black p-4 text-sm text-white ring-1 ring-white/10">
      <div className="flex items-center gap-2">
        <span className="label-mono rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/70">
          {file.kind === "document" ? "Document" : file.kind === "table" ? "Table" : "Diagram"}
        </span>
        <span className="flex-1 truncate font-medium">{file.title}</span>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="label-mono text-[10px] text-white/60 hover:text-white"
        >
          {open ? "Hide" : "Preview"}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-white/60 hover:text-white"
        >
          ×
        </button>
      </div>
      <div
        ref={preview}
        className={`max-h-72 overflow-auto rounded-2xl bg-white p-4 text-[13px] text-[#1d161d] ${
          open ? "" : "hidden"
        }`}
      >
        {file.kind === "document" && <Markdown text={file.body} />}
        {file.kind === "table" && (
          <table className="w-full border-collapse text-left">
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={i === 0 ? "font-semibold" : ""}>
                  {r.map((c, j) => (
                    <td key={j} className="border border-black/10 px-2 py-1">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {file.kind === "flow" && file.flow && (
          <div className="rounded-xl bg-black p-3">
            <FlowDiagram flow={file.flow} maxWidth={360} />
            {file.body && <p className="mt-2 text-xs text-white/70">{file.body}</p>}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() =>
            onCopy(file.kind === "flow" && file.flow ? flowSvg(file.flow, file.title) : file.body)
          }
          className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-black"
        >
          Copy
        </button>
        {formats.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => void save(f)}
            className="label-mono rounded-full px-3 py-1.5 text-[10px] text-white/80 ring-1 ring-white/20 hover:ring-[#b794ff]"
          >
            Save {f.toUpperCase()}
          </button>
        ))}
        {saved && <span className="text-xs text-white/60">Saved to Downloads as {saved}</span>}
      </div>
    </div>
  );
}
