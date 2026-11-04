/**
 * A drawing with numbered marks is a walkthrough: it stays over the screen.
 * A diagram the user asked for in words ("draw me…", "illustrate…") is an
 * illustration: it shows in the chat, where the file card's Save buttons keep
 * it one tap from a file. Any other diagram explains what's in front of them
 * ("Show me", "explain this"), so it draws over the screen too.
 */
import { wantsDrawing } from "./scene";
import type { Drawing, MadeFile } from "./service";

/** The illustration in a drawing, if it belongs in the chat rather than over the screen. */
export function illustrationOf(drawing: Drawing, said: string): MadeFile | null {
  if (drawing.marks.length > 0 || !drawing.flow || !wantsDrawing(said)) return null;
  return { kind: "flow", title: drawing.title ?? "Diagram", body: "", flow: drawing.flow };
}
