import { llm } from "@livekit/agents";
import { z } from "zod";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`livekit-trial: set ${name} in .env.local`);
  return value;
}

/**
 * One tool call into the Persuna app under test. Timed on one JSON line per
 * call, the same shape as the app's voice-turn logs, so tool latency reads
 * off the trial output directly.
 */
async function callTool(tool: string, args: unknown): Promise<string> {
  const appUrl = required("PERSUNA_APP_URL").replace(/\/+$/, "");
  const started = performance.now();
  const res = await fetch(`${appUrl}/api/persuna/livekit-tool`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${required("LIVEKIT_TOOL_SECRET")}`,
    },
    body: JSON.stringify({ userEmail: required("PERSUNA_USER_EMAIL"), tool, args }),
    signal: AbortSignal.timeout(15_000),
  });
  const ms = Math.round(performance.now() - started);
  const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  const ok = res.ok && body?.ok === true;
  console.log(JSON.stringify({ scope: "trial-tool", tool, ms, ok }));
  if (!ok) throw new Error(body?.error ?? `tool ${tool} failed with HTTP ${res.status}`);
  return tool === "rememberFact" ? "Kept it in memory." : "Added to the to-dos.";
}

/**
 * The trial's tools: the smallest set that proves the loop (hear → decide →
 * act in Persuna → speak). Reminders land as plain to-dos with the time in
 * words; parsing times is production scope, not trial scope.
 */
export function persunaTools() {
  return [
    llm.tool({
      name: "rememberFact",
      description:
        "Keep a short fact the user wants remembered (a preference, how they like things done). Call it when they say to remember something.",
      parameters: z.object({
        fact: z.string().describe("The fact in their words, one short sentence."),
      }),
      execute: async ({ fact }) => callTool("rememberFact", { fact }),
    }),
    llm.tool({
      name: "setReminder",
      description:
        "Add a to-do for the user. Call it when they ask to be reminded of something or to add a to-do. The time stays in words inside the text.",
      parameters: z.object({
        text: z
          .string()
          .describe(
            "What to remember, with any time in words (for example: call Ada tomorrow at 3).",
          ),
      }),
      execute: async ({ text }) => callTool("setReminder", { text, at: null }),
    }),
  ];
}
