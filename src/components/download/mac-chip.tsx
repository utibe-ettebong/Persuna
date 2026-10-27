"use client";

import { useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

/**
 * Guesses the Mac's chip. Browsers report every Mac as "Intel", but the
 * graphics renderer they expose names Apple's GPU on Apple silicon.
 */
function guessChip(): "apple" | "intel" | "unknown" {
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    const renderer = info ? String(gl!.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
    if (/Apple (M\d|GPU)/i.test(renderer)) return "apple";
    if (/Intel|AMD|Radeon|NVIDIA/i.test(renderer)) return "intel";
  } catch {
    // No WebGL: fall back to asking.
  }
  return "unknown";
}

const useChip = () => useSyncExternalStore(noSubscribe, guessChip, () => "unknown" as const);

/** Puts the Mac download that matches this Mac first. */
export function MacChoice({ apple, intel }: { apple: React.ReactNode; intel: React.ReactNode }) {
  const chip = useChip();
  return chip === "intel" ? (
    <>
      {intel}
      {apple}
    </>
  ) : (
    <>
      {apple}
      {intel}
    </>
  );
}

export function MacChipNote() {
  const chip = useChip();
  if (chip === "unknown") {
    return (
      <>
        Not sure which Mac you have? Apple menu → About This Mac: &ldquo;Chip: Apple M…&rdquo; means
        Apple silicon; &ldquo;Processor: Intel&rdquo; means Intel.
      </>
    );
  }
  return <>This looks like {chip === "apple" ? "an Apple silicon" : "an Intel"} Mac.</>;
}
