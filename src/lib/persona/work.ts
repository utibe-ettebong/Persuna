/**
 * Work mode's pacing, kept here so it's tested: how often Persuna looks, how
 * long it stays quiet after speaking up, and how it tells that the screen has
 * changed and what you were doing, without keeping what's on it.
 */
import type { Scene } from "./scene";

/** How often Persuna looks while Work mode is on (only when the screen changed). */
export const WORK_EVERY_MS = 15_000;
/** After stepping in, Persuna only follows quietly for this long. */
export const WORK_QUIET_MS = 120_000;
/** How many earlier moments go with each look. */
export const TRAIL_LENGTH = 6;

/** A fingerprint of the screen: the same app, window, selection and first few things. */
export function sceneDigest(scene: Scene): string {
  const first = scene.items
    .slice(0, 24)
    .map((i) => `${i.role}:${i.label}`)
    .join("|");
  return [scene.app, scene.window, scene.selection, first].join("¦");
}

/**
 * One line for the trail: the app and window, and what's typed in a search
 * box if there is one, so repeated searching shows up.
 */
export function trailLine(scene: Scene): string {
  const search = scene.items.find((i) => i.role === "search")?.label;
  return [scene.app || "Unknown app", scene.window, search && `searching "${search}"`]
    .filter(Boolean)
    .join(" — ")
    .slice(0, 300);
}

/** The trail with this moment added, unless it's the same as the last one. */
export function extendTrail(trail: string[], line: string): string[] {
  return trail.at(-1) === line ? trail : [...trail, line].slice(-TRAIL_LENGTH);
}
