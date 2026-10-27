/**
 * How a persona looks: a colour pair for its fluid body. Stored in
 * `persona_profiles.avatar`. Older profiles held an emoji, which reads as the
 * default look.
 */
export const LOOKS = {
  plum: { label: "Plum", from: "#b78bd6", to: "#4a1d68", glow: "#9a5cc6" },
  aurora: { label: "Aurora", from: "#7ef0d0", to: "#5b3fd1", glow: "#5fd6c4" },
  ember: { label: "Ember", from: "#ffb36b", to: "#c2185b", glow: "#ff7a59" },
  lagoon: { label: "Lagoon", from: "#8fd3ff", to: "#1f5fbf", glow: "#4aa8ff" },
  moss: { label: "Moss", from: "#d4f08a", to: "#2e6b4f", glow: "#8cc56a" },
  ink: { label: "Ink", from: "#8a8193", to: "#16121a", glow: "#6f6678" },
} as const;

export type LookId = keyof typeof LOOKS;
export const LOOK_IDS = Object.keys(LOOKS) as [LookId, ...LookId[]];
export const DEFAULT_LOOK: LookId = "plum";

export function lookOf(value: string | null | undefined): LookId {
  return value && value in LOOKS ? (value as LookId) : DEFAULT_LOOK;
}

/** The download page for Persuna Desktop (it reads the latest GitHub release). */
export const DESKTOP_DOWNLOAD_URL = "/download";
