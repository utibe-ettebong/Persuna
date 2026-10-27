"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/** A due time in the viewer's own time zone (the server doesn't know it). */
export function LocalTime({ iso }: { iso: string }) {
  const text = useSyncExternalStore(
    noop,
    () =>
      new Date(iso).toLocaleString(undefined, {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      }),
    () => "",
  );
  return (
    <time dateTime={iso} className="label-mono text-muted">
      {text}
    </time>
  );
}
