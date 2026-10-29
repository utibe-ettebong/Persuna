/**
 * SAM 3.1 (Meta's Segment Anything): given a screenshot and a short name
 * ("Reply button"), where that thing is. On Meta's /v1/responses endpoint,
 * not chat completions. Used only when Persuna points at something its list
 * of the screen doesn't name.
 */
import { modelProvider, samConfig } from "@/env";
import { parseSamBox } from "@/lib/persona/scene";

export interface Locator {
  /** The box around `thing` in the screenshot's pixels, or null if it isn't there. */
  locate(image: string, thing: string): Promise<ReturnType<typeof parseSamBox>>;
}

export function createLocator(fetchImpl: typeof fetch = fetch): Locator | null {
  const config = samConfig();
  if (!config || modelProvider() === "mock") return null;
  return {
    async locate(image, thing) {
      const res = await fetchImpl(`${config.baseUrl.replace(/\/+$/, "")}/responses`, {
        method: "POST",
        headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: thing },
                { type: "input_image", image_url: image },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as {
        output?: { content?: { type?: string; text?: string }[] }[];
      };
      const text = body.output
        ?.flatMap((o) => o.content ?? [])
        .find((c) => c.type === "output_text")?.text;
      return text ? parseSamBox(text) : null;
    },
  };
}
