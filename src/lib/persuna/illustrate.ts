/**
 * Every drawing goes over the screen and builds while Persuna speaks: numbered
 * marks on the things it means, a flow diagram for an illustration. Only a
 * file the user asked to keep shows as a card.
 */
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
