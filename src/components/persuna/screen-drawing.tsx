"use client";

import { useEffect, useRef, useState } from "react";
import { FLOW_FILLS, layoutFlow } from "@/lib/persuna/flow-layout";
import type { Drawing } from "@/lib/persuna/service";
import type { Flow } from "@/lib/persuna/types";
import { shownSteps } from "./narration";

/**
 * Boxes and arrows: the same layout the saved SVG uses. `shown` limits it to
 * the boxes said so far (arrows appear once both ends have); `floating` draws
 * it straight over the screen, with a soft shadow instead of a card behind it.
 * A box with more to say opens it below on tap (hover shows it anywhere).
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
  const [openId, setOpenId] = useState<string | null>(null);
  const open = l.nodes.find((n) => n.id === openId && n.detail);
  const toggle = (id: string) => setOpenId((cur) => (cur === id ? null : id));
  return (
    <>
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
            id="persuna-arrow"
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
                markerEnd="url(#persuna-arrow)"
                className="persuna-draw-line"
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
          .map((n) => {
            const paint = n.color
              ? FLOW_FILLS[n.color]
              : {
                  fill: floating ? "rgba(12,10,18,0.78)" : "#141414",
                  stroke: floating ? "#b794ff" : "rgba(255,255,255,0.7)",
                };
            const openable = Boolean(n.detail);
            return (
              <g
                key={n.id}
                className={`persuna-in ${openable ? "pointer-events-auto" : ""}`}
                onClick={openable ? () => toggle(n.id) : undefined}
                onKeyDown={openable ? (e) => e.key === "Enter" && toggle(n.id) : undefined}
                role={openable ? "button" : undefined}
                tabIndex={openable ? 0 : undefined}
                aria-label={openable ? `${n.lines.join(" ")}: show more` : undefined}
                style={openable ? { cursor: "pointer" } : undefined}
              >
                {openable && <title>{n.detail}</title>}
                {n.shape ? (
                  <path
                    d={n.shape}
                    transform={`translate(${n.x},${n.y}) scale(${n.w / 100},${n.h / 100})`}
                    fill={paint.fill}
                    stroke={paint.stroke}
                    strokeWidth={1.5}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : (
                  <rect
                    x={n.x}
                    y={n.y}
                    width={n.w}
                    height={n.h}
                    rx={14}
                    fill={paint.fill}
                    stroke={paint.stroke}
                    strokeWidth={1.5}
                  />
                )}
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
            );
          })}
      </svg>
      {open?.detail && (
        <p className="persuna-in mt-2 rounded-xl bg-white/10 px-3 py-2 text-xs leading-snug text-white">
          {open.detail}
        </p>
      )}
    </>
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
  progress = null,
}: {
  drawing: Drawing;
  onDone: () => void;
  /** Time per step when nobody is speaking (the fallback pacing). */
  paceMs?: number;
  /**
   * How much of the reply has been spoken (0..1), when it's being read out:
   * steps then appear with the words instead of on a timer. Null = timed.
   */
  progress?: number | null;
}) {
  // Steps appear one at a time while Persuna explains them: notes first, then boxes.
  const total = drawing.marks.length + (drawing.flow?.nodes.length ?? 0);
  const [step, setStep] = useState(1);
  // A new drawing starts from its first step, not where the last one ended.
  const [stepDrawing, setStepDrawing] = useState(drawing);
  if (stepDrawing !== drawing) {
    setStepDrawing(drawing);
    setStep(1);
  }
  useEffect(() => {
    if (progress != null || step >= total) return;
    const t = window.setTimeout(() => setStep((n) => n + 1), paceMs);
    return () => window.clearTimeout(t);
  }, [step, total, paceMs, progress]);
  const shown = progress == null ? step : shownSteps(progress, total);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onDone();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);
  // Off the server, everything fits: the client places notes once it renders.
  const viewport =
    typeof window === "undefined"
      ? { w: Number.MAX_SAFE_INTEGER, h: Number.MAX_SAFE_INTEGER }
      : { w: window.innerWidth, h: window.innerHeight };
  const marks = drawing.marks.slice(0, shown).filter((m) => onScreenSpot(m.spot, viewport));
  const boxes = Math.max(0, shown - drawing.marks.length);
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
      {marks.map((m) => {
        const place = notePlacement(m.spot, viewport);
        return (
          <div
            key={m.n}
            className="persuna-in absolute"
            style={{
              left: m.spot.x - 5,
              top: m.spot.y - 5,
              width: m.spot.w + 10,
              height: m.spot.h + 10,
            }}
          >
            {m.shape === "circle" ? (
              <svg
                className="absolute inset-0 h-full w-full"
                aria-hidden
                style={{ filter: "drop-shadow(0 0 10px rgba(167,123,255,0.55))" }}
              >
                <ellipse
                  cx="50%"
                  cy="50%"
                  rx="50%"
                  ry="50%"
                  fill="none"
                  stroke="#b794ff"
                  strokeWidth={2.5}
                />
              </svg>
            ) : (
              <span className="absolute inset-0 rounded-xl ring-[2.5px] ring-[#b794ff] shadow-[0_0_24px_4px_rgba(167,123,255,0.4)]" />
            )}
            <span className="absolute -left-3 -top-3 grid h-6 w-6 place-items-center rounded-full bg-black text-[11px] font-semibold text-white ring-2 ring-[#b794ff]">
              {m.n}
            </span>
            <span
              className={`absolute max-w-72 whitespace-normal rounded-2xl bg-black px-3 py-1.5 text-xs leading-snug text-white shadow-lg ${
                place.side === "left" ? "left-4" : "right-4"
              } ${place.above ? "bottom-[calc(100%+10px)]" : "top-[calc(100%+10px)]"}`}
              style={{ maxWidth: "min(18rem, calc(100vw - 2rem))" }}
            >
              {m.note}
            </span>
          </div>
        );
      })}
      {drawing.flow && boxes > 0 && (
        <div className="pointer-events-none absolute right-8 top-28 max-h-[75vh] max-w-[min(44rem,60vw)]">
          {drawing.title && (
            <p className="persuna-in mb-3 inline-block rounded-full bg-black/80 px-3 py-1 text-sm font-medium text-white shadow-lg">
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

/** A note's width (max-w-72) and the room one needs above or below its mark, gap included. */
const NOTE_W = 288;
const NOTE_ROOM = 76;

/**
 * Where a mark's note goes so it stays on this screen: off the mark's left
 * edge, or its right edge near the screen's right edge; above the mark, or
 * below it near the top (or when above would run off). Pure, so it's tested.
 */
export function notePlacement(
  spot: Area,
  viewport: { w: number; h: number },
  topMargin = 70,
): { side: "left" | "right"; above: boolean } {
  const boxL = spot.x - 5;
  const boxT = spot.y - 5;
  const boxB = spot.y + spot.h + 5;
  const side = boxL + 16 + NOTE_W > viewport.w - 8 ? "right" : "left";
  const aboveFits = boxT - NOTE_ROOM >= 8;
  const belowFits = boxB + NOTE_ROOM <= viewport.h - 8;
  const above = spot.y > topMargin ? aboveFits || !belowFits : !belowFits && aboveFits;
  return { side, above };
}

/** Whether a spot's centre is inside this view: marks centred off it can't be drawn here. */
export function onScreenSpot(spot: Area, viewport: { w: number; h: number }): boolean {
  const cx = spot.x + spot.w / 2;
  const cy = spot.y + spot.h / 2;
  return cx >= 0 && cy >= 0 && cx <= viewport.w && cy <= viewport.h;
}

/** At most this many thumbnails ride with an explanation. */
const MAX_SHOTS = 4;

/**
 * Where a screen area sits in the look's picture. A circled look's picture is
 * already cropped to the circle, so the area is measured from the circle and
 * the picture spans its width; an area outside the circle isn't in it at all.
 */
export function shotIn(
  area: Area,
  screenWidth: number,
  crop: Area | null,
): { area: Area; width: number } | null {
  if (!crop) return { area, width: screenWidth };
  const inside =
    area.x < crop.x + crop.w &&
    area.x + area.w > crop.x &&
    area.y < crop.y + crop.h &&
    area.y + area.h > crop.y;
  if (!inside) return null;
  return { area: { ...area, x: area.x - crop.x, y: area.y - crop.y }, width: crop.w };
}

/**
 * What an explanation shows pictures of: one area per mark, then the pointed
 * thing, at most a few. The pictures themselves are cropped from the look's
 * screenshot on the device, so they never travel anywhere. Pure, so tested.
 */
export function shotAreas(
  drawing: { marks: { n: number; note: string; spot: Area }[] } | null,
  point: (Area & { label: string }) | null,
  max = MAX_SHOTS,
): { n: number; note: string; area: Area }[] {
  const shots = (drawing?.marks ?? []).map((m) => ({ n: m.n, note: m.note, area: m.spot }));
  if (point) {
    const { x, y, w, h } = point;
    shots.push({ n: shots.length + 1, note: point.label, area: { x, y, w, h } });
  }
  return shots.slice(0, max);
}

/** The explanation's pictures: what each numbered note (or point) shows. */
export function ShotStrip({ shots }: { shots: { n: number; note: string; src: string }[] }) {
  if (!shots.length) return null;
  return (
    <div className="flex gap-2 overflow-x-auto pb-1" aria-label="What the explanation shows">
      {shots.map((s) => (
        <figure key={s.n} className="relative w-24 shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={s.src}
            alt={s.note}
            className="h-14 w-24 rounded-lg object-cover ring-1 ring-white/20"
          />
          <span className="absolute -left-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-black text-[10px] font-semibold text-white ring-2 ring-[#b794ff]">
            {s.n}
          </span>
          <figcaption className="mt-1 line-clamp-2 text-[10px] leading-snug text-white/70">
            {s.note}
          </figcaption>
        </figure>
      ))}
    </div>
  );
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
