import { describe, expect, it } from "vitest";
import { parseChatExport, summarizeChats } from "./chat-import";

const chatgpt = JSON.stringify([
  {
    title: "Minutes draft",
    mapping: {
      a: {
        message: {
          author: { role: "user" },
          content: { content_type: "text", parts: ["Turn these notes into minutes"] },
        },
      },
      b: {
        message: {
          author: { role: "assistant" },
          content: { content_type: "text", parts: ["Here are the minutes…"] },
        },
      },
      c: {
        message: {
          author: { role: "user" },
          content: { content_type: "text", parts: ["No, use 24-hour times throughout"] },
        },
      },
    },
  },
]);

const claude = JSON.stringify([
  {
    name: "Report outline",
    chat_messages: [
      { sender: "human", text: "Outline the quarterly report" },
      { sender: "assistant", text: "Here is an outline…" },
      { sender: "human", text: "Change the headings to sentence case" },
      { sender: "human", text: "Actually put the summary first" },
    ],
  },
]);

describe("parseChatExport", () => {
  it("reads a ChatGPT export's shapes and corrections", () => {
    const { chats, source } = parseChatExport(chatgpt);

    expect(source).toBe("chatgpt");
    expect(chats).toHaveLength(1);
    expect(chats[0]).toMatchObject({ title: "Minutes draft", turns: 2, refined: 1 });
    expect(chats[0]!.corrections).toEqual(["No, use 24-hour times throughout"]);
  });

  it("reads a Claude export's shapes and corrections", () => {
    const { chats, source } = parseChatExport(claude);

    expect(source).toBe("claude");
    expect(chats).toHaveLength(1);
    expect(chats[0]).toMatchObject({ title: "Report outline", turns: 3, refined: 2 });
    expect(chats[0]!.corrections).toHaveLength(2);
  });

  it("counts pastes by length and code fences", () => {
    const pasted = JSON.stringify([
      {
        name: "Debug",
        chat_messages: [
          { sender: "human", text: "```js\nconst x = 1;\n```\nWhy does this fail?" },
          { sender: "assistant", text: "Because…" },
          { sender: "human", text: `Here is the log:\n${"line\n".repeat(20)}` },
        ],
      },
    ]);
    const { chats } = parseChatExport(pasted);

    expect(chats[0]).toMatchObject({ pasted: 2 });
  });

  it("refuses files it doesn't recognize", () => {
    expect(() => parseChatExport(JSON.stringify({ hello: "world" }))).toThrow(
      "isn't a ChatGPT or Claude export",
    );
    expect(() => parseChatExport("not json")).toThrow("isn't a ChatGPT or Claude export");
  });
});

describe("summarizeChats", () => {
  it("keeps shapes and correction quotes, not contents", () => {
    const { chats } = parseChatExport(chatgpt);
    const summary = summarizeChats("conversations.json", chats);

    expect(summary).toContain("1 conversation");
    expect(summary).toContain("2 turns");
    expect(summary).toContain("No, use 24-hour times throughout");
    expect(summary).not.toContain("Here are the minutes");
  });
});
