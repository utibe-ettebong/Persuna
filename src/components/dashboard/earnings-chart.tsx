"use client";

import { useState } from "react";

const W = 560;
const H = 180;
const PAD = { top: 16, right: 8, bottom: 26, left: 8 };

const usd = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/**
 * Money released to you per week, last eight weeks: one series, so no
 * legend (the title names it). Hover or focus a week for its amount; the
 * same numbers are in the table below for screen readers and printing.
 */
export function EarningsChart({ weeks }: { weeks: { week: string; cents: number }[] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...weeks.map((w) => w.cents), 1);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / weeks.length;
  const barW = Math.min(36, slot - 2 * 2 - 10);
  const base = PAD.top + plotH;
  const shown = active ?? weeks.length - 1;

  return (
    <figure className="space-y-2">
      <div className="flex items-baseline justify-between">
        <figcaption className="text-sm font-medium">Earned per week</figcaption>
        <p className="text-sm text-muted" aria-live="polite">
          <span className="font-display text-lg text-foreground">{usd(weeks[shown].cents)}</span>{" "}
          week of {day(weeks[shown].week)}
        </p>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full"
        role="img"
        aria-label="Earned per week, last eight weeks"
      >
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={base}
          y2={base}
          stroke="var(--line-strong)"
          strokeWidth={1}
        />
        {weeks.every((w) => w.cents === 0) && (
          <text
            x={W / 2}
            y={PAD.top + plotH / 2}
            textAnchor="middle"
            fontSize={13}
            fill="var(--faint)"
          >
            Nothing released yet. Payments show here week by week.
          </text>
        )}
        {weeks.map((w, i) => {
          const h = w.cents ? Math.max(4, (w.cents / max) * plotH) : 0;
          const x = PAD.left + i * slot + (slot - barW) / 2;
          const y = base - h;
          const r = Math.min(4, h);
          return (
            <g
              key={w.week}
              tabIndex={0}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              className="cursor-default outline-none"
            >
              {/* Hit area: the whole column, bigger than the bar. */}
              <rect
                x={PAD.left + i * slot}
                y={PAD.top}
                width={slot}
                height={plotH}
                fill="transparent"
              />
              {h > 0 && (
                <path
                  d={`M${x},${base} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${base} Z`}
                  fill="var(--chart-bar)"
                  opacity={active === null || active === i ? 1 : 0.45}
                />
              )}
              {i % 2 === weeks.length % 2 || i === weeks.length - 1 ? (
                <text
                  x={x + barW / 2}
                  y={H - 8}
                  textAnchor="middle"
                  fontSize={11}
                  fill="var(--muted)"
                >
                  {day(w.week)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <details className="text-xs text-muted">
        <summary className="cursor-pointer">Show as a table</summary>
        <table className="mt-2 w-full">
          <tbody>
            {weeks.map((w) => (
              <tr key={w.week} className="border-t border-line">
                <td className="py-1">Week of {day(w.week)}</td>
                <td className="py-1 text-right">{usd(w.cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
