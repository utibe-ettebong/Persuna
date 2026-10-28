/** Line icons for the companion, drawn to match one another. */
const PATHS = {
  sound:
    "M4 9v6h4l5 4V5L8 9H4Zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4Zm-2.5-8.7v2.1a7 7 0 0 1 0 13.2v2.1a9 9 0 0 0 0-17.4Z",
  mute: "M4 9v6h4l5 4V5L8 9H4Zm12.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4L16.6 12Z",
  task: "M16.5 6.5 8.4 14.6a1.6 1.6 0 0 0 2.3 2.3l8.5-8.6a3.2 3.2 0 0 0-4.5-4.5l-8.6 8.6a4.8 4.8 0 0 0 6.8 6.8l7.1-7.1",
  eye: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Zm9.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  float: "M14 4h6v6M20 4l-8 8M10 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-4",
  send: "M12 19V5m0 0-6 6m6-6 6 6",
  hide: "M5 12h14",
  keyboard: "M4 7h16v10H4zM7 10h1m3 0h1m3 0h1m3 0h0M8 14h8",
  ear: "M7 9a5 5 0 0 1 10 0c0 3-3 4-3 7a3 3 0 0 1-5.5 1.6M10 9.5a2 2 0 0 1 4 0",
  mic: "M12 4a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V7a3 3 0 0 1 3-3zM6 11a6 6 0 0 0 12 0M12 17v3",
} as const;

const FILLED = new Set(["sound", "mute"]);

export function Icon({ name }: { name: keyof typeof PATHS }) {
  const filled = FILLED.has(name);
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden>
      <path
        d={PATHS[name]}
        fill={filled ? "currentColor" : "none"}
        stroke={filled ? "none" : "currentColor"}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
