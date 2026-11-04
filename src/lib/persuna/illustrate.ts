/**
 * A drawing with numbered marks is a walkthrough: it stays over the screen.
 * A diagram the user asked for in words ("draw me…", "illustrate…") is an
 * illustration: it shows in the chat, where the file card's Save buttons keep
 * it one tap from a file. Any other diagram explains what's in front of them
 * ("Show me", "explain this"), so it draws over the screen too.
 */
import { wantsDrawing } from "./scene";
import type { Drawing, MadeFile } from "./service";
import type { Flow } from "./types";

/**
 * Marks that found nothing on screen to sit on, as numbered steps in a
 * diagram: an explanation still draws, it just isn't pinned to the screen.
 */
export function stepsAsFlow(notes: string[]): Flow | null {
  const steps = notes
    .map((n) => n.trim())
    .filter(Boolean)
    .slice(0, 14);
  if (!steps.length) return null;
  const nodes = steps.map((note, i) => ({
    id: `s${i + 1}`,
    label: note.length > 60 ? `${note.slice(0, 59)}…` : note,
    detail: note.length > 60 ? note.slice(0, 140) : null,
  }));
  const edges = nodes.slice(1).map((n, i) => ({ from: nodes[i].id, to: n.id }));
  return { direction: "down", nodes, edges };
}

/** The illustration in a drawing, if it belongs in the chat rather than over the screen. */
export function illustrationOf(drawing: Drawing, said: string): MadeFile | null {
  if (drawing.marks.length > 0 || !drawing.flow || !wantsDrawing(said)) return null;
  return { kind: "flow", title: drawing.title ?? "Diagram", body: "", flow: drawing.flow };
}
