/**
 * Lays out a small diagram Persuna drew (boxes and arrows) in rows or columns:
 * each box goes one step further than the furthest box pointing at it, so a
 * process reads top to bottom (or left to right). Pure, so the overlay, the
 * saved SVG and the tests all share it.
 */
import type { Flow } from "./types";

export const NODE_W = 172;
export const NODE_H = 52;
const GAP_MAIN = 44;
const GAP_CROSS = 22;
const PAD = 16;
/** Characters per line inside a box; two lines at most. */
const LINE_CHARS = 22;

export interface PlacedNode {
  id: string;
  lines: string[];
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacedEdge {
  from: string;
  to: string;
  label: string | null;
  /** An SVG path from the source box's edge to the target's. */
  path: string;
  /** Where the label sits. */
  lx: number;
  ly: number;
}

export interface FlowLayout {
  width: number;
  height: number;
  nodes: PlacedNode[];
  edges: PlacedEdge[];
}

/** A label in at most two lines, broken between words. */
export function wrapLabel(label: string, max = LINE_CHARS): string[] {
  const words = label.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= max || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= 2) return lines.map((l) => (l.length > max ? `${l.slice(0, max - 1)}…` : l));
  const second = lines.slice(1).join(" ");
  return [lines[0], `${second.slice(0, max - 1)}…`];
}

/** Each box's step: 0 for boxes nothing points at, else one past the furthest box before it. */
export function ranks(flow: Flow): Map<string, number> {
  const ids = new Set(flow.nodes.map((n) => n.id));
  const edges = flow.edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  const rank = new Map(flow.nodes.map((n) => [n.id, 0]));
  // Longest path, at most one pass per box, so a loop can't run forever.
  for (let pass = 0; pass < flow.nodes.length; pass++) {
    let changed = false;
    for (const e of edges) {
      const want = rank.get(e.from)! + 1;
      if (want > rank.get(e.to)! && want < flow.nodes.length) {
        rank.set(e.to, want);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return rank;
}

export function layoutFlow(flow: Flow): FlowLayout {
  const down = flow.direction !== "right";
  const rank = ranks(flow);
  const rows = new Map<number, string[]>();
  for (const n of flow.nodes) {
    const r = rank.get(n.id)!;
    rows.set(r, [...(rows.get(r) ?? []), n.id]);
  }
  const widest = Math.max(...[...rows.values()].map((r) => r.length));
  const depth = rows.size ? Math.max(...rows.keys()) + 1 : 0;
  // Sizes along the flow (main) and across it (cross).
  const mainSize = down ? NODE_H : NODE_W;
  const crossSize = down ? NODE_W : NODE_H;
  const crossSpan = widest * crossSize + (widest - 1) * GAP_CROSS;

  const placed = new Map<string, PlacedNode>();
  for (const [r, ids] of rows) {
    const span = ids.length * crossSize + (ids.length - 1) * GAP_CROSS;
    ids.forEach((id, i) => {
      const main = PAD + r * (mainSize + GAP_MAIN);
      const cross = PAD + (crossSpan - span) / 2 + i * (crossSize + GAP_CROSS);
      const label = flow.nodes.find((n) => n.id === id)!.label;
      placed.set(id, {
        id,
        lines: wrapLabel(label),
        x: down ? cross : main,
        y: down ? main : cross,
        w: NODE_W,
        h: NODE_H,
      });
    });
  }

  const edges = flow.edges.flatMap((e): PlacedEdge[] => {
    const a = placed.get(e.from);
    const b = placed.get(e.to);
    if (!a || !b || a === b) return [];
    const forward = down ? b.y > a.y : b.x > a.x;
    // Forward: out of the far side into the near side. Backward (a loop): around the side.
    const [x1, y1, x2, y2] = down
      ? forward
        ? [a.x + a.w / 2, a.y + a.h, b.x + b.w / 2, b.y]
        : [a.x + a.w, a.y + a.h / 2, b.x + b.w, b.y + b.h / 2]
      : forward
        ? [a.x + a.w, a.y + a.h / 2, b.x, b.y + b.h / 2]
        : [a.x + a.w / 2, a.y + a.h, b.x + b.w / 2, b.y + b.h];
    const bend = forward ? GAP_MAIN / 2 : 40;
    const [c1x, c1y, c2x, c2y] = down
      ? forward
        ? [x1, y1 + bend, x2, y2 - bend]
        : [x1 + bend, y1, x2 + bend, y2]
      : forward
        ? [x1 + bend, y1, x2 - bend, y2]
        : [x1, y1 + bend, x2, y2 + bend];
    return [
      {
        from: e.from,
        to: e.to,
        label: e.label ?? null,
        path: `M${x1},${y1} C${c1x},${c1y} ${c2x},${c2y} ${x2},${y2}`,
        lx: (x1 + x2) / 2 + (forward ? 8 : bend),
        ly: (y1 + y2) / 2,
      },
    ];
  });

  const mainSpan = depth * mainSize + Math.max(0, depth - 1) * GAP_MAIN;
  // Arrows going back (loops) curve out past the side: leave room for them.
  const loops = flow.edges.some((e) => {
    const a = placed.get(e.from);
    const b = placed.get(e.to);
    return a && b && a !== b && (down ? b.y <= a.y : b.x <= a.x);
  })
    ? 48
    : 0;
  return {
    width: Math.round((down ? crossSpan : mainSpan) + 2 * PAD + (down ? loops : 0)),
    height: Math.round((down ? mainSpan : crossSpan) + 2 * PAD + (down ? 0 : loops)),
    nodes: [...placed.values()],
    edges,
  };
}

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The diagram as a standalone SVG file: white boxes on black, like it looks over the screen. */
export function flowSvg(flow: Flow, title: string | null = null): string {
  const l = layoutFlow(flow);
  const top = title ? 40 : 0;
  const nodes = l.nodes
    .map((n) => {
      const cx = n.x + n.w / 2;
      const first = n.y + n.h / 2 - (n.lines.length - 1) * 8;
      const text = n.lines
        .map(
          (line, i) =>
            `<text x="${cx}" y="${first + i * 16}" text-anchor="middle" dominant-baseline="middle">${escapeXml(line)}</text>`,
        )
        .join("");
      return `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="14" fill="#141414" stroke="#ffffff" stroke-opacity="0.7" stroke-width="1.5"/>${text}`;
    })
    .join("");
  const edges = l.edges
    .map(
      (e) =>
        `<path d="${e.path}" fill="none" stroke="#b794ff" stroke-width="2" marker-end="url(#arrow)"/>${
          e.label
            ? `<text x="${e.lx}" y="${e.ly}" font-size="11" fill="#cdb8ff">${escapeXml(e.label)}</text>`
            : ""
        }`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${l.width}" height="${l.height + top}" viewBox="0 ${-top} ${l.width} ${l.height + top}" font-family="-apple-system, Segoe UI, sans-serif" font-size="13" fill="#ffffff"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#b794ff"/></marker></defs><rect x="0" y="${-top}" width="${l.width}" height="${l.height + top}" fill="#000000"/>${
    title
      ? `<text x="${l.width / 2}" y="-16" text-anchor="middle" font-size="15" font-weight="600">${escapeXml(title)}</text>`
      : ""
  }${edges}${nodes}</svg>`;
}
