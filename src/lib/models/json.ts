import { z } from "zod";
import type { ModelRole } from "@/env";
import type { ChatMessage, CompleteOptions, Completion, ModelClient } from "./gateway";

/**
 * Pulls the first JSON object out of a model reply. Tolerates code fences and
 * prose around the object, since not every provider supports a JSON mode.
 */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new SyntaxError("No JSON object in model reply");
  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * Asks for JSON matching `schema`. On a parse or validation failure the error
 * goes back to the model once so it can repair its own output.
 */
export async function completeJson<T>(
  client: ModelClient,
  role: ModelRole,
  messages: ChatMessage[],
  schema: z.ZodType<T>,
  options?: CompleteOptions,
): Promise<{ value: T; completion: Completion }> {
  const first = await client.complete(role, messages, options);
  const firstTry = parse(first.text, schema);
  if (firstTry.ok) return { value: firstTry.value, completion: first };

  const second = await client.complete(
    role,
    [
      ...messages,
      { role: "assistant", content: first.text },
      {
        role: "user",
        content: `That reply was not valid. ${firstTry.error}\nReply again with only the corrected JSON object.`,
      },
    ],
    options,
  );
  const secondTry = parse(second.text, schema);
  if (!secondTry.ok)
    throw new Error(`${role} model returned invalid JSON twice: ${secondTry.error}`);

  return {
    value: secondTry.value,
    completion: {
      ...second,
      promptTokens: first.promptTokens + second.promptTokens,
      completionTokens: first.completionTokens + second.completionTokens,
    },
  };
}

function parse<T>(
  text: string,
  schema: z.ZodType<T>,
): { ok: true; value: T } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  const result = schema.safeParse(raw);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, error: z.prettifyError(result.error) };
}
