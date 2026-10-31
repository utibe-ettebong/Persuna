import { describe, expect, it } from "vitest";
import { operateAction, previewOperate } from "./actions";

describe("operateAction", () => {
  it("accepts the four desktop actions", () => {
    expect(operateAction.parse({ kind: "click", x: 120, y: 300, label: "Send" })).toMatchObject({
      kind: "click",
    });
    expect(operateAction.parse({ kind: "type", text: "hello", label: "greeting" })).toMatchObject({
      kind: "type",
    });
    expect(
      operateAction.parse({ kind: "key", key: "enter", modifiers: [], label: "submit" }),
    ).toMatchObject({ kind: "key" });
    expect(operateAction.parse({ kind: "open", app: "Mail", label: "open mail" })).toMatchObject({
      kind: "open",
    });
  });

  it("fails closed on coordinates, text and keys it cannot run safely", () => {
    expect(() =>
      operateAction.parse({ kind: "click", x: -1, y: 5, label: "off screen" }),
    ).toThrow();
    expect(() => operateAction.parse({ kind: "click", x: 1.5, y: 5, label: "off" })).toThrow();
    expect(() => operateAction.parse({ kind: "type", text: "", label: "empty" })).toThrow();
    expect(() =>
      operateAction.parse({ kind: "type", text: "a".repeat(501), label: "too long" }),
    ).toThrow();
    expect(() =>
      operateAction.parse({ kind: "type", text: "a\u0007b", label: "control char" }),
    ).toThrow();
    expect(() => operateAction.parse({ kind: "key", key: "f13", label: "no" })).toThrow();
    expect(() =>
      operateAction.parse({ kind: "open", app: "Mail; rm -rf ~", label: "injection" }),
    ).toThrow();
    expect(() => operateAction.parse({ kind: "open", app: "", label: "empty" })).toThrow();
  });
});

describe("previewOperate", () => {
  it("says in plain words what the desktop is about to do", () => {
    expect(previewOperate({ kind: "click", x: 120, y: 300, label: "the Send button" })).toBe(
      'Click "the Send button" at 120, 300',
    );
    expect(previewOperate({ kind: "type", text: "hello there", label: "greeting" })).toBe(
      'Type "hello there"',
    );
    expect(previewOperate({ kind: "key", key: "s", modifiers: ["command"], label: "save" })).toBe(
      "Press Command+S",
    );
    expect(previewOperate({ kind: "open", app: "Mail", label: "open mail" })).toBe("Open Mail");
  });
});

describe("what the card shows", () => {
  const text = "x".repeat(400);

  it("shows typed text in full", () => {
    expect(previewOperate(operateAction.parse({ kind: "type", text, label: "Type" }))).toContain(
      text,
    );
  });

  it("refuses line breaks, so Return is never hidden in typed text", () => {
    for (const hidden of ["rm -rf ~\\n", "one\\rtwo"]) {
      const value = hidden.replace("\\n", "\n").replace("\\r", "\r");
      expect(operateAction.safeParse({ kind: "type", text: value, label: "Type" }).success).toBe(
        false,
      );
    }
  });
});
