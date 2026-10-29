"use client";

import { useEffect, useRef, useState } from "react";
import { layoutFlow } from "@/lib/persona/flow-layout";
import type { Drawing } from "@/lib/persona/service";
import type { Flow } from "@/lib/persona/types";

/**
 * Boxes and arrows: the same layout the saved SVG uses. `shown` limits it to
 * the boxes said so far (arrows appear once both ends have); `floating` draws
 * it straight over the screen, with a soft shadow instead of a card behind it.
 */
export function FlowDiagram({
  flow,
  maxWidth,
  shown,
  floating = false,
}: {
  flow: Flow;
  maxWidth?: number;
  shown?: number;
  floating?: boolean;
}) {
  const l = layoutFlow(flow);
  const order = flow.nodes.map((n) => n.id);
  const visible = (id: string) => shown === undefined || order.indexOf(id) < shown;
  const scale = maxWidth && l.width > maxWidth ? maxWidth / l.width : 1;
  return (
    <svg
      role="img"
      aria-label={flow.nodes.map((n) => n.label).join(", then ")}
      width={l.width * scale}
      height={l.height * scale}
      viewBox={`0 0 ${l.width} ${l.height}`}
      className="block overflow-visible"
      style={floating ? { filter: "drop-shadow(0 4px 14px rgba(0,0,0,0.45))" } : undefined}
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
      {l.edges
        .filter((e) => visible(e.from) && visible(e.to))
        .map((e) => (
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
      {l.nodes
        .filter((n) => visible(n.id))
        .map((n) => (
          <g key={n.id} className="persona-in">
            <rect
              x={n.x}
              y={n.y}
              width={n.w}
              height={n.h}
              rx={14}
              fill={floating ? "rgba(12,10,18,0.78)" : "#141414"}
              stroke={floating ? "#b794ff" : "rgba(255,255,255,0.7)"}
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
export function DrawingLayer({
  drawing,
  onDone,
  paceMs = 1100,
}: {
  drawing: Drawing;
  onDone: () => void;
  /** Time per step, so the drawing keeps up with what Persuna is saying. */
  paceMs?: number;
}) {
  // Steps appear one at a time while Persuna explains them: notes first, then boxes.
  const total = drawing.marks.length + (drawing.flow?.nodes.length ?? 0);
  const [step, setStep] = useState(1);
  useEffect(() => {
    if (step >= total) return;
    const t = window.setTimeout(() => setStep((n) => n + 1), paceMs);
    return () => window.clearTimeout(t);
  }, [step, total, paceMs]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onDone();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);
  const marks = drawing.marks.slice(0, step);
  const boxes = Math.max(0, step - drawing.marks.length);
  const centres = marks.map((m) => ({
    x: m.spot.x + m.spot.w / 2,
    y: m.spot.y + m.spot.h / 2,
  }));
  const trail = centres.map((c, i) => `${i ? "L" : "M"}${c.x},${c.y}`).join(" ");
  return (
    <div aria-label={drawing.title ?? "Drawing"} className="pointer-events-none fixed inset-0">
      {marks.length > 1 && (
        <svg className="absolute inset-0 h-full w-full" aria-hidden>
          <path d={trail} fill="none" stroke="#b794ff" strokeWidth={2} strokeDasharray="6 7" />
        </svg>
      )}
      {marks.map((m) => (
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
      {drawing.flow && boxes > 0 && (
        <div className="pointer-events-none absolute right-8 top-28 max-h-[75vh] max-w-[min(44rem,60vw)]">
          {drawing.title && (
            <p className="persona-in mb-3 inline-block rounded-full bg-black/80 px-3 py-1 text-sm font-medium text-white shadow-lg">
              {drawing.title}
            </p>
          )}
          <FlowDiagram flow={drawing.flow} maxWidth={640} shown={boxes} floating />
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

export interface CirclePick {
  area: Area;
  /** The loop as drawn, as an SVG path in screen points. */
  path: string;
}

/** A loop drawn with the pointer, as an SVG path, and the box around it. */
export function loopOf(points: { x: number; y: number }[]): CirclePick | null {
  if (points.length < 3) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const area = {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
  if (area.w < 12 || area.h < 12) return null;
  const path = `${points.map((p, i) => `${i ? "L" : "M"}${Math.round(p.x)},${Math.round(p.y)}`).join(" ")} Z`;
  return { area, path };
}

/**
 * Circle something to ask about it: draw a loop around it with the pointer.
 * Esc cancels. The whole screen takes the pointer while this is up.
 */
export function CircleLayer({
  onPick,
  onCancel,
}: {
  onPick: (pick: CirclePick) => void;
  onCancel: () => void;
}) {
  const points = useRef<{ x: number; y: number }[]>([]);
  const [path, setPath] = useState("");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  const draw = () =>
    setPath(points.current.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" "));
  return (
    <div
      className="pointer-events-auto fixed inset-0 cursor-crosshair bg-black/10"
      onPointerDown={(e) => {
        points.current = [{ x: e.clientX, y: e.clientY }];
        draw();
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const last = points.current.at(-1);
        if (!last || Math.hypot(e.clientX - last.x, e.clientY - last.y) < 3) return;
        points.current.push({ x: e.clientX, y: e.clientY });
        draw();
      }}
      onPointerUp={() => {
        const pick = loopOf(points.current);
        points.current = [];
        if (!pick) return setPath("");
        onPick(pick);
      }}
    >
      <p className="label-mono pointer-events-none absolute left-1/2 top-24 -translate-x-1/2 rounded-full bg-black px-4 py-2 text-[11px] text-white">
        Circle what you want to ask about · Esc to cancel
      </p>
      {path && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
          <path
            d={path}
            fill="rgba(183,148,255,0.08)"
            stroke="#b794ff"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ filter: "drop-shadow(0 0 6px rgba(167,123,255,0.7))" }}
          />
        </svg>
      )}
    </div>
  );
}

/** The loop you drew, kept on screen until your next message uses it. */
export function CircledMark({ path }: { path: string }) {
  return (
    <svg className="pointer-events-none fixed inset-0 h-full w-full" aria-hidden>
      <path
        d={path}
        fill="rgba(183,148,255,0.06)"
        stroke="#b794ff"
        strokeWidth={2.5}
        strokeDasharray="7 6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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
