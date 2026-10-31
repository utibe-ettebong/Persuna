/**
 * AI chat history (layer 4): the shape of how the owner prompts, from a
 * ChatGPT or Claude export they choose to share. Shapes are kept (how long,
 * pastes, refinement turns, what they corrected the AI on); the content of
 * pastes and replies is never kept. Corrections are rules in disguise.
 */
export interface ChatShape {
  title: string;
  /** User turns. */
  turns: number;
  /** User turns that look like pastes (long, many lines, or code-fenced). */
  pasted: number;
  /** User turns after the first assistant reply (iterations). */
  refined: number;
  /** User turns correcting the AI — candidate rules, in their words. */
  corrections: string[];
}

const CORRECTION =
  /^(no[,.!]|wrong\b|not |don't |dont |change\b|fix\b|instead\b|redo\b|try again\b|actually\b|that'?s (not|wrong))/i;

function isPaste(text: string): boolean {
  return text.length > 500 || text.split("\n").length > 8 || text.includes("```");
}

function shapes(title: string, turns: { role: "user" | "assistant"; text: string }[]): ChatShape {
  const user = turns.filter((turn) => turn.role === "user");
  const firstReply = turns.findIndex((turn) => turn.role === "assistant");
  return {
    title: title.trim().slice(0, 120) || "Untitled chat",
    turns: user.length,
    pasted: user.filter((turn) => isPaste(turn.text)).length,
    refined:
      firstReply < 0
        ? 0
        : turns.filter((turn, index) => turn.role === "user" && index > firstReply).length,
    corrections: user
      .filter(
        (turn, index) => index > 0 && !isPaste(turn.text) && CORRECTION.test(turn.text.trim()),
      )
      .map((turn) => turn.text.trim().slice(0, 300)),
  };
}

interface ChatGptConversation {
  title?: string;
  mapping?: Record<string, { message?: unknown }>;
}

interface ClaudeConversation {
  name?: string;
  chat_messages?: { sender?: string; text?: string }[];
}

function isChatGpt(value: unknown): value is ChatGptConversation[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "object" && item !== null && "mapping" in item)
  );
}

function isClaude(value: unknown): value is ClaudeConversation[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "object" && item !== null && "chat_messages" in item)
  );
}

/** Parses a ChatGPT or Claude conversations.json export into shapes. */
export function parseChatExport(text: string): {
  chats: ChatShape[];
  source: "chatgpt" | "claude";
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file isn't a ChatGPT or Claude export.");
  }
  if (isChatGpt(parsed)) {
    return {
      source: "chatgpt",
      chats: parsed.map((conversation) => {
        const turns: { role: "user" | "assistant"; text: string }[] = [];
        for (const node of Object.values(conversation.mapping ?? {})) {
          const message = node.message as {
            author?: { role?: string };
            content?: { parts?: unknown };
          };
          const role = message?.author?.role;
          const parts = message?.content?.parts;
          if ((role === "user" || role === "assistant") && Array.isArray(parts)) {
            const text = parts
              .filter((part): part is string => typeof part === "string")
              .join("\n");
            if (text.trim()) turns.push({ role, text });
          }
        }
        return shapes(conversation.title ?? "", turns);
      }),
    };
  }
  if (isClaude(parsed)) {
    return {
      source: "claude",
      chats: parsed.map((conversation) =>
        shapes(
          conversation.name ?? "",
          (conversation.chat_messages ?? [])
            .filter((message) => message.sender === "human" || message.sender === "assistant")
            .map((message) => ({
              role: message.sender === "human" ? ("user" as const) : ("assistant" as const),
              text: message.text ?? "",
            }))
            .filter((turn) => turn.text.trim().length > 0),
        ),
      ),
    };
  }
  throw new Error("That file isn't a ChatGPT or Claude export.");
}

/** Shapes as interview evidence: counts plus correction quotes (capped). */
export function summarizeChats(name: string, chats: ChatShape[]): string {
  const lines = [
    `AI chats (${name}, ${chats.length} conversation${chats.length === 1 ? "" : "s"}):`,
    ...chats.map(
      (chat) =>
        `- "${chat.title}": ${chat.turns} turns, pasted ${chat.pasted}×, refined ${chat.refined}×`,
    ),
  ];
  const corrections = chats.flatMap((chat) => chat.corrections).slice(0, 10);
  if (corrections.length > 0) {
    lines.push("Corrections given to the AI:", ...corrections.map((quote) => `- "${quote}"`));
  }
  return lines.join("\n");
}
