/**
 * What's on the user's screen, as Persona Desktop reads it on their computer
 * (the front app's accessibility tree, and on a Mac the text it recognises),
 * turned into a short numbered list for the model, and back into a place on
 * screen when the model points at something. Pure, so it's tested directly.
 */
import { z } from "zod";

const box = { x: z.number(), y: z.number(), w: z.number(), h: z.number() };

export const sceneSchema = z.object({
  /** The main display, in points; every box below is relative to its top-left. */
  screen: z.object({ w: z.number().positive(), h: z.number().positive() }),
  app: z.string().max(200).default(""),
  window: z.string().max(300).default(""),
  items: z
    .array(z.object({ role: z.string().max(30), label: z.string().max(300), ...box }))
    .max(400)
    .default([]),
  text: z
    .array(z.object({ text: z.string().max(300), ...box }))
    .max(400)
    .default([]),
});
export type Scene = z.infer<typeof sceneSchema>;

export interface Spot {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

/** Most entries the model sees: enough for a busy window, small enough to stay quick. */
const MAX_ITEMS = 160;
const MAX_LINES = 120;

const onScreen = (s: Scene) => (b: { x: number; y: number; w: number; h: number }) =>
  b.w > 0 && b.h > 0 && b.x + b.w > 0 && b.y + b.h > 0 && b.x < s.screen.w && b.y < s.screen.h;

const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * The numbered entries: e1… for the app's own elements, t1… for lines of text
 * read off the screen that the elements don't already say.
 */
export function sceneEntries(scene: Scene) {
  const visible = onScreen(scene);
  const items = scene.items.filter(visible).slice(0, MAX_ITEMS);
  const said = new Set(items.map((i) => norm(i.label)));
  const lines = scene.text
    .filter(visible)
    .filter((l) => !said.has(norm(l.text)))
    .slice(0, MAX_LINES);
  return [
    ...items.map((i, n) => ({ id: `e${n + 1}`, kind: i.role, label: i.label, box: i })),
    ...lines.map((l, n) => ({ id: `t${n + 1}`, kind: "text", label: l.text, box: l })),
  ];
}

/** For the prompt: one entry per line, with a rough place ("top left") rather than numbers. */
export function sceneForModel(scene: Scene): string {
  const where = (b: { x: number; y: number; w: number; h: number }) => {
    const cx = (b.x + b.w / 2) / scene.screen.w;
    const cy = (b.y + b.h / 2) / scene.screen.h;
    const v = cy < 0.33 ? "top" : cy > 0.66 ? "bottom" : "middle";
    const h = cx < 0.33 ? "left" : cx > 0.66 ? "right" : "centre";
    return `${v} ${h}`;
  };
  const head = [scene.app && `App: ${scene.app}`, scene.window && `Window: ${scene.window}`]
    .filter(Boolean)
    .join("\n");
  const lines = sceneEntries(scene).map(
    (e) => `${e.id} ${e.kind} "${e.label.replace(/\s+/g, " ")}" (${where(e.box)})`,
  );
  return [head, ...lines].filter(Boolean).join("\n");
}

/**
 * Too little to go on without the picture: few readable elements and little
 * text (a photo, a video, a design canvas, a game).
 */
export function sceneIsThin(scene: Scene): boolean {
  const entries = sceneEntries(scene);
  const words = entries.reduce((n, e) => n + e.label.split(/\s+/).length, 0);
  return entries.length < 6 || words < 25;
}

/** The place on screen of an entry the model pointed at (e12, t3), or null. */
export function spotOf(scene: Scene, id: string): Spot | null {
  const entry = sceneEntries(scene).find((e) => e.id === id);
  if (!entry) return null;
  const { x, y, w, h } = entry.box;
  return { x, y, w, h, label: entry.label };
}

/** Questions that need the picture itself, whatever the list says. */
export function wantsPicture(text: string): boolean {
  return /\b(photo|picture|image|pic|colou?rs?|looks? like|design|logo|chart|graph|diagram|drawing|video|face|screenshot)\b/i.test(
    text,
  );
}

/**
 * SAM 3.1's answer for one prompt: "<|box;x1=80;y1=400;x2=240;y2=450;w=1280;h=800|>…".
 * The box is in the screenshot's pixels; w and h are the screenshot's size.
 */
export function parseSamBox(
  text: string,
): { x1: number; y1: number; x2: number; y2: number; w: number; h: number } | null {
  const m = /<\|box;([^|]*)\|>/.exec(text);
  if (!m) return null;
  const v = Object.fromEntries(
    m[1].split(";").map((kv) => {
      const [k, n] = kv.split("=");
      return [k, Number(n)];
    }),
  );
  const keys = ["x1", "y1", "x2", "y2", "w", "h"] as const;
  if (!keys.every((k) => Number.isFinite(v[k]))) return null;
  if (v.x2 <= v.x1 || v.y2 <= v.y1 || v.w <= 0 || v.h <= 0) return null;
  return { x1: v.x1, y1: v.y1, x2: v.x2, y2: v.y2, w: v.w, h: v.h };
}

/** A SAM box (screenshot pixels) as a place on screen (points). */
export function samSpot(
  box: NonNullable<ReturnType<typeof parseSamBox>>,
  scene: Scene,
  label: string,
): Spot {
  const k = scene.screen.w / box.w;
  return {
    x: Math.round(box.x1 * k),
    y: Math.round(box.y1 * k),
    w: Math.round((box.x2 - box.x1) * k),
    h: Math.round((box.y2 - box.y1) * k),
    label,
  };
}
