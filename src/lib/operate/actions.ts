import { z } from "zod";

/**
 * One thing Persuna may do on the Mac in Work mode (plan §6): click, type,
 * press a key, or open an app. The schema fails closed — anything outside it
 * never reaches the desktop — and every action carries the label the user
 * approved, shown before it runs.
 */
export const operateAction = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("click"),
    x: z.number().int().min(0).max(10_000),
    y: z.number().int().min(0).max(10_000),
    label: z.string().trim().min(1).max(140),
  }),
  z.object({
    kind: z.literal("type"),
    text: z
      .string()
      .min(1)
      .max(500)
      // No line breaks: pressing Return is its own approved step, never hidden in text.
      .refine((text) => !/[\u0000-\u0008\u000a-\u001f\u007f]/.test(text), {
        message: "Typed text carries no line breaks or control characters",
      }),
    label: z.string().trim().min(1).max(140),
  }),
  z.object({
    kind: z.literal("key"),
    key: z.string().regex(/^(enter|tab|escape|space|up|down|left|right|delete|[a-z0-9])$/, {
      message: "Only plain keys and shortcuts",
    }),
    modifiers: z
      .array(z.enum(["command", "shift", "option", "control"]))
      .max(3)
      .default([]),
    label: z.string().trim().min(1).max(140),
  }),
  z.object({
    kind: z.literal("open"),
    app: z.string().regex(/^[\w][\w .'\-]{0,60}$/, { message: "An app name, nothing to run" }),
    label: z.string().trim().min(1).max(140),
  }),
]);

export type OperateAction = z.infer<typeof operateAction>;

const MODIFIER = {
  command: "Command",
  shift: "Shift",
  option: "Option",
  control: "Control",
} as const;

/** What the approval card shows: the action in the user's own words. */
export function previewOperate(action: OperateAction): string {
  switch (action.kind) {
    case "click":
      return `Click "${action.label}" at ${action.x}, ${action.y}`;
    case "type":
      return `Type "${action.text}"`;
    case "key": {
      const named: Record<string, string> = {
        enter: "Enter",
        tab: "Tab",
        escape: "Escape",
        space: "Space",
        up: "↑",
        down: "↓",
        left: "←",
        right: "→",
        delete: "Delete",
      };
      const key = named[action.key] ?? action.key.toUpperCase();
      const mods = action.modifiers.map((mod) => MODIFIER[mod]);
      return `Press ${[...mods, key].join("+")}`;
    }
    case "open":
      return `Open ${action.app}`;
  }
}
