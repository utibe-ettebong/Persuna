import { z } from "zod";
import { sceneSchema } from "./scene";

/**
 * Form fields shared by the Persuna server actions and the streaming voice
 * route. They live here, not in the actions file, because a "use server"
 * module may only export async functions — routes can't import its schemas.
 */
export const dayField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const FRAME_TYPES = /^data:image\/(jpeg|png|webp);base64,/;
/** About 1.5 MB of image once decoded. */
export const MAX_FRAME_CHARS = 2_000_000;

export const clockField = z.object({
  day: dayField,
  now: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  offset: z.number().int().min(-900).max(900),
});

/** A screenshot sent with a turn: a JPEG, PNG or WebP data URL of a sensible size, or nothing. */
export const screenField = z
  .string()
  .regex(FRAME_TYPES, "That screen image couldn't be read")
  .max(MAX_FRAME_CHARS)
  .nullish();

/** What Persuna may see with a message (Persuna Desktop): a screenshot and the list of the screen. */
export const sightField = z
  .object({ image: screenField, scene: sceneSchema.nullish(), circled: z.boolean().optional() })
  .nullish()
  .transform((s) =>
    s && (s.image || s.scene)
      ? { image: s.image ?? null, scene: s.scene ?? null, circled: Boolean(s.circled) }
      : null,
  );
