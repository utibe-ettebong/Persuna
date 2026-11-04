/**
 * A drawing with numbered marks is a walkthrough: it stays over the screen.
 * A drawing with only a diagram is an illustration: it shows in the chat,
 * where the file card's Save buttons keep it one tap from a file.
 */
import type { Drawing, MadeFile } from "./service";

/** The illustration in a drawing, if it has no marks to pin over the screen. */
export function illustrationOf(drawing: Drawing): MadeFile | null {
  if (drawing.marks.length > 0 || !drawing.flow) return null;
  return { kind: "flow", title: drawing.title ?? "Diagram", body: "", flow: drawing.flow };
}
