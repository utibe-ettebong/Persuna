"use client";

import { useEffect, useId, useRef } from "react";
import { LOOKS, lookOf } from "@/lib/persona/looks";

export type OrbState = "idle" | "listening" | "thinking" | "speaking" | "watching" | "sleeping";

/**
 * Persona's body: a liquid drop that breathes, looks at your cursor, blinks,
 * ripples with your voice while it listens, swirls while it thinks, and
 * shapes its mouth while it talks. Drawn in SVG and moved with
 * requestAnimationFrame through refs, so React never re-renders per frame.
 */
export function PersonaOrb({
  look,
  state = "idle",
  level = 0,
  size = 72,
  animate = true,
  className = "",
}: {
  look: string;
  state?: OrbState;
  /** 0–1: microphone loudness while listening, speech energy while speaking. */
  level?: number;
  size?: number;
  animate?: boolean;
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const palette = LOOKS[lookOf(look)];
  const body = useRef<SVGPathElement>(null);
  const shine = useRef<SVGEllipseElement>(null);
  const eyes = useRef<SVGGElement>(null);
  const lids = useRef<SVGGElement>(null);
  const mouth = useRef<SVGPathElement>(null);
  const ripples = useRef<SVGGElement>(null);
  const motes = useRef<SVGGElement>(null);
  const lens = useRef<SVGCircleElement>(null);
  const swirlA = useRef<SVGCircleElement>(null);
  const swirlB = useRef<SVGCircleElement>(null);
  const spark = useRef<SVGGElement>(null);
  const root = useRef<SVGSVGElement>(null);
  const live = useRef({ state, level });
  useEffect(() => {
    live.current = { state, level };
  }, [state, level]);

  useEffect(() => {
    if (!animate) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let gaze = { x: 0, y: 0 };
    let target = { x: 0, y: 0 };
    let blinkAt = performance.now() + 2500;
    let smoothLevel = 0;
    const phases = Array.from({ length: 9 }, (_, i) => i * 1.7 + Math.random());

    const onMove = (e: PointerEvent) => {
      const box = root.current?.getBoundingClientRect();
      if (!box) return;
      const dx = e.clientX - (box.left + box.width / 2);
      const dy = e.clientY - (box.top + box.height / 2);
      const d = Math.hypot(dx, dy) || 1;
      const reach = Math.min(1, d / 400);
      target = { x: (dx / d) * reach, y: (dy / d) * reach };
    };
    window.addEventListener("pointermove", onMove);

    const tick = (now: number) => {
      const t = now / 1000;
      const { state: s, level: l } = live.current;
      smoothLevel += (l - smoothLevel) * 0.25;
      const calm = reduced ? 0.3 : 1;

      // Body: a closed curve through points whose radius wobbles.
      const energy =
        (s === "listening" ? 0.05 + smoothLevel * 0.12 : 0) +
        (s === "speaking" ? 0.04 + smoothLevel * 0.08 : 0) +
        (s === "thinking" ? 0.05 : 0) +
        (s === "sleeping" ? -0.015 : 0);
      const speed = s === "thinking" ? 2.4 : s === "sleeping" ? 0.5 : 1.2;
      const breath = Math.sin(t * (s === "sleeping" ? 0.9 : 1.6)) * 0.02;
      const n = phases.length;
      const pts = phases.map((p, i) => {
        const a = (i / n) * Math.PI * 2;
        const wob =
          (0.035 + energy) * Math.sin(t * speed + p) * calm +
          0.02 * Math.sin(t * speed * 1.7 + p * 2) * calm;
        const r = 34 * (1 + breath + wob);
        return [50 + Math.cos(a) * r, 52 + Math.sin(a) * r * 0.96] as const;
      });
      body.current?.setAttribute("d", closedCurve(pts));

      // Eyes follow the cursor; while thinking they drift up, while watching they scan.
      if (s === "thinking") target = { x: Math.sin(t * 1.3) * 0.5, y: -0.7 };
      if (s === "watching") target = { x: Math.sin(t * 0.8), y: Math.sin(t * 0.37) * 0.3 };
      gaze = { x: gaze.x + (target.x - gaze.x) * 0.12, y: gaze.y + (target.y - gaze.y) * 0.12 };
      eyes.current?.setAttribute("transform", `translate(${gaze.x * 6} ${gaze.y * 5})`);
      shine.current?.setAttribute("transform", `translate(${-gaze.x * 2} ${-gaze.y * 2})`);

      // Blink every few seconds; asleep means closed.
      let open = 1;
      if (s === "sleeping") open = 0.08;
      else if (now > blinkAt) {
        const k = (now - blinkAt) / 140;
        open = k < 1 ? 1 - k : k < 2 ? k - 1 : 1;
        if (k >= 2) blinkAt = now + 2200 + Math.random() * 3800;
      }
      lids.current?.setAttribute(
        "transform",
        `translate(0 52) scale(1 ${Math.max(0.06, open)}) translate(0 -52)`,
      );

      // Mouth: a soft smile that opens with speech.
      const talk = s === "speaking" ? 2 + smoothLevel * 7 + Math.abs(Math.sin(t * 13)) * 2.5 : 0;
      const smile = s === "sleeping" ? 0.5 : s === "thinking" ? 0.2 : 2.2;
      mouth.current?.setAttribute(
        "d",
        `M43 ${66 + gaze.y * 2} Q50 ${66 + smile + talk + gaze.y * 2} 57 ${66 + gaze.y * 2}` +
          (talk > 0.5 ? ` Q50 ${66 + smile + talk * 0.25 + gaze.y * 2} 43 ${66 + gaze.y * 2}` : ""),
      );

      // Listening: rings that swell with your voice.
      if (ripples.current) {
        ripples.current.style.opacity = s === "listening" ? "1" : "0";
        [...ripples.current.children].forEach((c, i) => {
          const k = ((t * 0.8 + i / 3) % 1) * (0.6 + smoothLevel);
          c.setAttribute("r", String(38 + k * 22));
          c.setAttribute("opacity", String((1 - k) * 0.5));
        });
      }
      // Thinking: three motes orbit.
      if (motes.current) {
        motes.current.style.opacity = s === "thinking" ? "1" : "0";
        [...motes.current.children].forEach((c, i) => {
          const a = t * 2.2 + (i * Math.PI * 2) / 3;
          c.setAttribute("cx", String(50 + Math.cos(a) * 44));
          c.setAttribute("cy", String(52 + Math.sin(a) * 18 - 4));
        });
      }
      // Liquid inside the body: two lights drifting in slow loops, faster when busy.
      const swirl = s === "thinking" ? 1.8 : s === "speaking" || s === "listening" ? 1.3 : 0.6;
      swirlA.current?.setAttribute("cx", String(50 + Math.sin(t * swirl * 0.9) * 14));
      swirlA.current?.setAttribute("cy", String(56 + Math.cos(t * swirl * 0.7) * 12));
      swirlB.current?.setAttribute("cx", String(50 + Math.cos(t * swirl * 0.6 + 2) * 16));
      swirlB.current?.setAttribute("cy", String(50 + Math.sin(t * swirl * 1.1 + 1) * 10));
      // The spark: Persona's signature, orbiting; it brightens when Persona is active.
      if (spark.current) {
        const a = t * (s === "sleeping" ? 0.15 : s === "idle" ? 0.5 : 1.4);
        const x = 50 + Math.cos(a) * 47;
        const y = 50 + Math.sin(a) * 20 - 6;
        const glint = s === "sleeping" ? 0.25 : 0.6 + 0.4 * Math.abs(Math.sin(t * 2.3));
        spark.current.setAttribute(
          "transform",
          `translate(${x} ${y}) rotate(${(t * 90) % 360}) scale(${0.6 + glint * 0.5})`,
        );
        spark.current.style.opacity = String(glint);
      }
      if (lens.current) {
        lens.current.style.opacity = s === "watching" ? "1" : "0";
        lens.current.setAttribute("stroke-dashoffset", String(-t * 30));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
    };
  }, [animate]);

  const still = closedCurve(
    Array.from({ length: 9 }, (_, i) => {
      const a = (i / 9) * Math.PI * 2;
      return [50 + Math.cos(a) * 34, 52 + Math.sin(a) * 33] as const;
    }),
  );

  return (
    <svg
      ref={root}
      viewBox="-10 -10 120 124"
      width={size}
      height={size * 1.03}
      className={`overflow-visible ${className}`}
      aria-hidden
    >
      <defs>
        <radialGradient id={`b${id}`} cx="35%" cy="30%" r="80%">
          <stop offset="0%" stopColor={palette.from} />
          <stop offset="100%" stopColor={palette.to} />
        </radialGradient>
        <radialGradient id={`s${id}`}>
          <stop offset="0%" stopColor="white" stopOpacity="0.55" />
          <stop offset="60%" stopColor={palette.from} stopOpacity="0.35" />
          <stop offset="100%" stopColor={palette.from} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`g${id}`}>
          <stop offset="0%" stopColor={palette.glow} stopOpacity="0.55" />
          <stop offset="100%" stopColor={palette.glow} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="54" r="58" fill={`url(#g${id})`} />
      <g ref={ripples} style={{ opacity: 0, transition: "opacity .3s" }}>
        {[0, 1, 2].map((i) => (
          <circle
            key={i}
            cx="50"
            cy="52"
            r="40"
            fill="none"
            stroke={palette.glow}
            strokeWidth="1.5"
          />
        ))}
      </g>
      <circle
        ref={lens}
        cx="50"
        cy="52"
        r="46"
        fill="none"
        stroke={palette.glow}
        strokeWidth="1.5"
        strokeDasharray="4 7"
        style={{ opacity: 0, transition: "opacity .3s" }}
      />
      <path ref={body} id={`p${id}`} d={still} fill={`url(#b${id})`} />
      <clipPath id={`c${id}`}>
        <use href={`#p${id}`} />
      </clipPath>
      <g clipPath={`url(#c${id})`} style={{ mixBlendMode: "screen" }}>
        <circle ref={swirlA} cx="56" cy="60" r="18" fill={`url(#s${id})`} />
        <circle ref={swirlB} cx="42" cy="46" r="13" fill={`url(#s${id})`} opacity="0.7" />
      </g>
      <use
        href={`#p${id}`}
        fill="none"
        stroke="white"
        strokeOpacity="0.35"
        strokeWidth="1.2"
        style={{ mixBlendMode: "overlay" }}
      />
      <ellipse ref={shine} cx="37" cy="33" rx="11" ry="6" fill="white" opacity="0.4" />
      <ellipse cx="31" cy="62" rx="5" ry="3" fill="#ff8fb1" opacity="0.28" />
      <ellipse cx="69" cy="62" rx="5" ry="3" fill="#ff8fb1" opacity="0.28" />
      <g ref={eyes}>
        <clipPath id={`e${id}`}>
          <ellipse cx="40" cy="52" rx="6" ry="7.8" />
          <ellipse cx="60" cy="52" rx="6" ry="7.8" />
        </clipPath>
        <g ref={lids}>
          <g clipPath={`url(#e${id})`}>
            <rect x="30" y="40" width="40" height="24" fill="white" />
            <circle cx="40.5" cy="53" r="4" fill="#1d161d" />
            <circle cx="60.5" cy="53" r="4" fill="#1d161d" />
            <circle cx="41.8" cy="51.4" r="1.1" fill="white" />
            <circle cx="61.8" cy="51.4" r="1.1" fill="white" />
          </g>
        </g>
      </g>
      <path
        ref={mouth}
        d="M43 66 Q50 68 57 66"
        fill="#1d161d"
        fillOpacity="0.55"
        stroke="#1d161d"
        strokeOpacity="0.7"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <g ref={spark} transform="translate(92 44) scale(0.8)">
        <path d="M0 -5 L1.3 -1.3 L5 0 L1.3 1.3 L0 5 L-1.3 1.3 L-5 0 L-1.3 -1.3 Z" fill="white" />
        <circle r="2" fill={palette.glow} />
      </g>
      <g ref={motes} style={{ opacity: 0, transition: "opacity .3s" }}>
        {[0, 1, 2].map((i) => (
          <circle key={i} r="2.6" cx="50" cy="10" fill={palette.from} />
        ))}
      </g>
    </svg>
  );
}

/** A smooth closed path through points (Catmull-Rom as cubic Béziers). */
function closedCurve(pts: readonly (readonly [number, number])[]): string {
  const n = pts.length;
  let d = `M${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(2)} ${c1[1].toFixed(2)} ${c2[0].toFixed(2)} ${c2[1].toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return `${d}Z`;
}
