"use client";

import { useEffect, useRef } from "react";

/**
 * How Work mode sees what you're doing, shown as the dot's colour: green when
 * it's your usual way, amber when you seem unsure, coral when it differs from
 * how you usually do it, blue while explaining, purple before it knows.
 */
export type DotTone = "on_track" | "unsure" | "off" | "explain" | "new";

const COLOURS: Record<DotTone, string> = {
  on_track: "#5cc98f",
  unsure: "#ffc94d",
  off: "#ff7a6b",
  explain: "#7ab8ff",
  new: "#b794ff",
};
const LABELS: Record<DotTone, string> = {
  on_track: "Following: this is your usual way",
  unsure: "Following: you seem unsure here",
  off: "Following: this differs from your usual way",
  explain: "Explaining",
  new: "Following along",
};

/** Where the dot sits from the pointer, so it never covers what you point at. */
const OFFSET = { x: 18, y: 20 };
const TRAIL = 7;

/**
 * Work mode's dot: it follows your pointer around the screen (Persuna
 * Desktop passes pointer movement to the page), leaving a short fading trail,
 * pulses while it looks, and shows a question or correction right beside it.
 * It's drawn without React re-renders, so it keeps up with the pointer.
 */
export function WorkDot({
  tone,
  looking,
  bubble,
  hint = null,
}: {
  tone: DotTone;
  looking: boolean;
  /** What Persuna is asking or pointing out, shown next to the dot. */
  bubble: string | null;
  /** How to answer it ("Hold right ⌥ to answer"). */
  hint?: string | null;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const trail = useRef<(HTMLSpanElement | null)[]>([]);
  const bubbleEl = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const target = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const pos = { ...target };
    const past: { x: number; y: number }[] = [];
    let frame = 0;
    const onMove = (e: MouseEvent) => {
      target.x = e.clientX + OFFSET.x;
      target.y = e.clientY + OFFSET.y;
    };
    const step = () => {
      // Eases towards the pointer: it follows, it doesn't stick.
      pos.x += (target.x - pos.x) * 0.22;
      pos.y += (target.y - pos.y) * 0.22;
      if (box.current) box.current.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
      past.unshift({ x: pos.x, y: pos.y });
      past.length = Math.min(past.length, TRAIL * 2);
      trail.current.forEach((el, i) => {
        const p = past[(i + 1) * 2];
        if (el && p) el.style.transform = `translate(${p.x}px, ${p.y}px)`;
      });
      // The bubble stays on screen: it flips to the left near the right edge.
      if (bubbleEl.current) {
        const flip = pos.x > window.innerWidth - 300;
        bubbleEl.current.style.left = flip ? "auto" : "14px";
        bubbleEl.current.style.right = flip ? "14px" : "auto";
      }
      frame = requestAnimationFrame(step);
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    frame = requestAnimationFrame(step);
    return () => {
      window.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(frame);
    };
  }, []);

  const colour = COLOURS[tone];
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[60]">
      {Array.from({ length: TRAIL }, (_, i) => (
        <span
          key={i}
          ref={(el) => {
            trail.current[i] = el;
          }}
          className="absolute left-0 top-0 -ml-[3px] -mt-[3px] h-1.5 w-1.5 rounded-full transition-colors duration-500"
          style={{ background: colour, opacity: 0.32 - i * 0.04 }}
        />
      ))}
      <div ref={box} className="absolute left-0 top-0">
        <span className="sr-only" role="status">
          {LABELS[tone]}
        </span>
        {looking && (
          <span
            className="absolute -left-3 -top-3 h-6 w-6 animate-ping rounded-full"
            style={{ background: colour, opacity: 0.35 }}
          />
        )}
        <span
          className="absolute -left-[7px] -top-[7px] block h-3.5 w-3.5 rounded-full ring-2 ring-black/70 transition-colors duration-500"
          style={{ background: colour, boxShadow: `0 0 14px 3px ${colour}88` }}
        />
        {bubble && (
          <div
            ref={bubbleEl}
            className="persuna-in absolute top-3 w-max max-w-64 rounded-2xl rounded-tl-md bg-black px-3 py-2 text-[12.5px] leading-snug text-white shadow-[0_10px_30px_-10px_rgba(0,0,0,0.7)]"
            style={{ borderTop: `2px solid ${colour}` }}
          >
            {bubble.length > 260 ? `${bubble.slice(0, 260)}…` : bubble}
            {hint && (
              <span className="label-mono mt-1.5 block text-[9px] text-white/45">{hint}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
