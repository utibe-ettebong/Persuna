"use client";

import { useEffect, useRef, useState } from "react";
import { layoutFlow } from "@/lib/persona/flow-layout";
import type { Drawing } from "@/lib/persona/service";
import type { Flow } from "@/lib/persona/types";

/** Boxes and arrows, white on black: the same layout the saved SVG uses. */
export function FlowDiagram({ flow, maxWidth }: { flow: Flow; maxWidth?: number }) {
  const l = layoutFlow(flow);
  const scale = maxWidth && l.width > maxWidth ? maxWidth / l.width : 1;
  return (
    <svg
      role="img"
      aria-label={flow.nodes.map((n) => n.label).join(", then ")}
      width={l.width * scale}
      height={l.height * scale}
      viewBox={`0 0 ${l.width} ${l.height}`}
      className="block"
    >
      <defs>
        <marker
          id="persona-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" fill="#b794ff" />
        </marker>
      </defs>
      {l.edges.map((e) => (
        <g key={`${e.from}-${e.to}`}>
          <path
            d={e.path}
            fill="none"
            stroke="#b794ff"
            strokeWidth={2}
            markerEnd="url(#persona-arrow)"
            className="persona-draw-line"
          />
          {e.label && (
            <text x={e.lx} y={e.ly} fontSize={11} fill="#cdb8ff">
              {e.label}
            </text>
          )}
        </g>
      ))}
      {l.nodes.map((n) => (
        <g key={n.id}>
          <rect
            x={n.x}
            y={n.y}
            width={n.w}
            height={n.h}
            rx={14}
            fill="#141414"
            stroke="rgba(255,255,255,0.7)"
            strokeWidth={1.5}
          />
          {n.lines.map((line, i) => (
            <text
              key={i}
              x={n.x + n.w / 2}
              y={n.y + n.h / 2 - (n.lines.length - 1) * 8 + i * 16}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={13}
              fill="#fff"
            >
              {line}
            </text>
          ))}
        </g>
      ))}
    </svg>
  );
}

/**
 * What Persuna drew over the screen: numbered notes on the things it means,
 * joined in order by a dashed line, and a diagram card when it drew one.
 * Click anywhere on it (or Done, or Esc) to put it away.
 */
export function DrawingLayer({ drawing, onDone }: { drawing: Drawing; onDone: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onDone();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);
  const centres = drawing.marks.map((m) => ({
    x: m.spot.x + m.spot.w / 2,
    y: m.spot.y + m.spot.h / 2,
  }));
  const trail = centres.map((c, i) => `${i ? "L" : "M"}${c.x},${c.y}`).join(" ");
  return (
    <div aria-label={drawing.title ?? "Drawing"} className="pointer-events-none fixed inset-0">
      {drawing.marks.length > 1 && (
        <svg className="absolute inset-0 h-full w-full" aria-hidden>
          <path d={trail} fill="none" stroke="#b794ff" strokeWidth={2} strokeDasharray="6 7" />
        </svg>
      )}
      {drawing.marks.map((m) => (
        <div
          key={m.n}
          className="persona-in absolute"
          style={{
            left: m.spot.x - 5,
            top: m.spot.y - 5,
            width: m.spot.w + 10,
            height: m.spot.h + 10,
          }}
        >
          <span className="absolute inset-0 rounded-xl ring-[2.5px] ring-[#b794ff] shadow-[0_0_24px_4px_rgba(167,123,255,0.4)]" />
          <span className="absolute -left-3 -top-3 grid h-6 w-6 place-items-center rounded-full bg-black text-[11px] font-semibold text-white ring-2 ring-[#b794ff]">
            {m.n}
          </span>
          <span
            className={`absolute left-4 max-w-72 whitespace-normal rounded-2xl bg-black px-3 py-1.5 text-xs leading-snug text-white shadow-lg ${
              m.spot.y > 70 ? "bottom-[calc(100%+10px)]" : "top-[calc(100%+10px)]"
            }`}
          >
            {m.note}
          </span>
        </div>
      ))}
      {drawing.flow && (
        <div className="persona-in pointer-events-auto absolute right-6 top-24 max-h-[75vh] max-w-[min(44rem,60vw)] overflow-auto rounded-[26px] bg-black p-5 text-white shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)] ring-1 ring-white/10">
          {drawing.title && <p className="mb-3 text-sm font-medium">{drawing.title}</p>}
          <FlowDiagram flow={drawing.flow} maxWidth={640} />
        </div>
      )}
      <button
        type="button"
        onClick={onDone}
        className="pointer-events-auto label-mono absolute bottom-8 left-1/2 -translate-x-1/2 rounded-full bg-black px-4 py-2 text-[11px] text-white ring-1 ring-white/15 hover:ring-[#b794ff]"
      >
        Done
      </button>
    </div>
  );
}

export interface Area {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Circle something to ask about it: drag a box around it. Esc cancels.
 * The whole screen takes the pointer while this is up.
 */
export function CircleLayer({
  onPick,
  onCancel,
}: {
  onPick: (area: Area) => void;
  onCancel: () => void;
}) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const [area, setArea] = useState<Area | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  const boxFrom = (a: { x: number; y: number }, b: { x: number; y: number }): Area => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  });
  return (
    <div
      className="pointer-events-auto fixed inset-0 cursor-crosshair bg-black/10"
      onPointerDown={(e) => {
        start.current = { x: e.clientX, y: e.clientY };
        setArea({ x: e.clientX, y: e.clientY, w: 0, h: 0 });
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) =>
        start.current && setArea(boxFrom(start.current, { x: e.clientX, y: e.clientY }))
      }
      onPointerUp={(e) => {
        const from = start.current;
        start.current = null;
        if (!from) return;
        const picked = boxFrom(from, { x: e.clientX, y: e.clientY });
        if (picked.w < 12 || picked.h < 12) return setArea(null);
        onPick(picked);
      }}
    >
      <p className="label-mono pointer-events-none absolute left-1/2 top-24 -translate-x-1/2 rounded-full bg-black px-4 py-2 text-[11px] text-white">
        Drag around what you want to ask about · Esc to cancel
      </p>
      {area && area.w > 0 && (
        <span
          className="pointer-events-none absolute rounded-2xl border-2 border-dashed border-[#b794ff] bg-[#b794ff]/10"
          style={{ left: area.x, top: area.y, width: area.w, height: area.h }}
        />
      )}
    </div>
  );
}

/** The part of a look's picture inside the circled area (the picture is scaled from points). */
export async function cropPicture(image: string, area: Area, screenWidth: number): Promise<string> {
  const img = new Image();
  img.src = image;
  await img.decode();
  const k = img.naturalWidth / screenWidth;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(area.w * k));
  canvas.height = Math.max(1, Math.round(area.h * k));
  canvas
    .getContext("2d")!
    .drawImage(
      img,
      area.x * k,
      area.y * k,
      area.w * k,
      area.h * k,
      0,
      0,
      canvas.width,
      canvas.height,
    );
  return canvas.toDataURL("image/jpeg", 0.85);
}
