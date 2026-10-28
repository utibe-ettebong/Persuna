/**
 * Doing a task in the user's apps, with no storage attached: the model picks
 * one tool at a time, reads run straight away, and the first write stops the
 * loop so the user can confirm it. Takes a ModelClient and an `execute`
 * function, so tests run it with fakes.
 */
import { z } from "zod";
import type { ModelClient } from "@/lib/models/gateway";
import { completeJson } from "@/lib/models/json";
import { appTaskMessages } from "@/lib/skill/prompts";
import type { Tool } from "./tools";

export const MAX_APP_STEPS = 5;

export const appStep = z.object({
  tool: z.string().trim().max(60).nullish(),
  args: z.record(z.string(), z.unknown()).nullish(),
  reply: z.string().trim().max(1500).nullish(),
});

export interface AppTaskResult {
  reply: string;
  /** A send or create the user must confirm. */
  pending: { tool: string; args: unknown; preview: string } | null;
  /** Tools that ran, in order. */
  used: string[];
}

export async function runAppTask(
  client: ModelClient,
  input: { name: string; goal: string; now: string; tools: Tool[] },
  execute: (tool: Tool, args: unknown) => Promise<unknown>,
): Promise<AppTaskResult> {
  const steps: { tool: string; args: unknown; result: unknown }[] = [];
  const used: string[] = [];
  for (let i = 0; i < MAX_APP_STEPS; i++) {
    const { value } = await completeJson(
      client,
      "draft",
      appTaskMessages({ ...input, tools: input.tools, steps }),
      appStep,
      { maxTokens: 4096 },
    );
    if (!value.tool) return { reply: value.reply || "Done.", pending: null, used };
    const tool = input.tools.find((t) => t.name === value.tool);
    if (!tool) {
      steps.push({
        tool: value.tool,
        args: value.args,
        result: { error: "There's no such tool." },
      });
      continue;
    }
    const args = tool.args.safeParse(value.args ?? {});
    if (!args.success) {
      steps.push({
        tool: tool.name,
        args: value.args,
        result: { error: z.prettifyError(args.error) },
      });
      continue;
    }
    if (tool.writes) {
      return {
        reply: value.reply || "Here's what I'll do. Shall I go ahead?",
        pending: {
          tool: tool.name,
          args: args.data,
          preview: tool.preview?.(args.data) ?? tool.name,
        },
        used,
      };
    }
    let result: unknown;
    try {
      result = await execute(tool, args.data);
      used.push(tool.name);
    } catch (error) {
      result = { error: `That didn't work: ${(error as Error).message}` };
    }
    steps.push({ tool: tool.name, args: args.data, result });
  }
  return {
    reply: "I couldn't finish that in a few steps. Could you ask a bit more specifically?",
    pending: null,
    used,
  };
}
