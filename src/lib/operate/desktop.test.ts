import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
// The desktop's operate module is plain Node (no Electron), pinned from here.
import { osaScripts, validOperateAction, winActLine } from "../../../desktop/operate.js";

describe("validOperateAction (desktop)", () => {
  it("accepts what the server proposes, and refuses the rest twice", () => {
    expect(validOperateAction({ kind: "click", x: 10, y: 20, label: "Send" })).toMatchObject({
      kind: "click",
      x: 10,
      y: 20,
    });
    expect(validOperateAction({ kind: "click", x: 10, y: 20, label: "" })).toBeNull();
    expect(validOperateAction({ kind: "click", x: -5, y: 20, label: "off" })).toBeNull();
    expect(validOperateAction({ kind: "key", key: "f13", label: "no" })).toBeNull();
    expect(
      validOperateAction({ kind: "open", app: 'Mail" -e evil', label: "injection" }),
    ).toBeNull();
    expect(validOperateAction(null)).toBeNull();
  });
});

describe("osaScripts", () => {
  it("clicks, types, presses and opens through System Events", () => {
    expect(osaScripts({ kind: "click", x: 10, y: 20, label: "Send" })).toEqual([
      'tell application "System Events" to click at {10, 20}',
    ]);
    expect(osaScripts({ kind: "type", text: "hi", label: "greet" })).toEqual([
      'tell application "System Events" to keystroke "hi"',
    ]);
    expect(osaScripts({ kind: "key", key: "s", modifiers: ["command"], label: "save" })).toEqual([
      'tell application "System Events" to keystroke "s" using {command down}',
    ]);
    expect(osaScripts({ kind: "key", key: "enter", modifiers: [], label: "go" })).toEqual([
      'tell application "System Events" to key code 36',
    ]);
    expect(osaScripts({ kind: "open", app: "Mail", label: "mail" })).toEqual([
      'tell application "Mail" to activate',
    ]);
  });

  it("escapes quotes and chunks long text for the stop word", () => {
    const [line] = osaScripts({ kind: "type", text: 'say "hi" \\ bye', label: "t" }) ?? [];
    expect(line).toBe('tell application "System Events" to keystroke "say \\"hi\\" \\\\ bye"');
    const chunks = osaScripts({ kind: "type", text: "a".repeat(100), label: "long" });
    expect(chunks).toHaveLength(3);
  });

  it("builds nothing for refused actions", () => {
    expect(osaScripts({ kind: "click", x: 1, y: 2, label: "" })).toBeNull();
    expect(osaScripts({ kind: "open", app: "Mail; rm -rf ~", label: "x" })).toBeNull();
  });
});

describe("the desktop's own check", () => {
  it("refuses line breaks in typed text, whatever the server said", () => {
    expect(validOperateAction({ kind: "type", text: "a\nb", label: "Type" })).toBeNull();
    expect(validOperateAction({ kind: "type", text: "a\rb", label: "Type" })).toBeNull();
    expect(validOperateAction({ kind: "type", text: "a b", label: "Type" })).not.toBeNull();
  });
});

describe("winActLine", () => {
  it("builds one helper line per validated action", () => {
    expect(winActLine({ kind: "click", x: 10, y: 20, label: "Send" }, 123)).toBe("click 123 10 20");
    expect(winActLine({ kind: "type", text: "hi", label: "greet" }, 123)).toBe("type 123 aGk=");
    expect(winActLine({ kind: "key", key: "s", modifiers: ["command"], label: "save" }, 123)).toBe(
      "key 123 ctrl s",
    );
    expect(winActLine({ kind: "key", key: "enter", modifiers: [], label: "go" }, 123)).toBe(
      "key 123 - enter",
    );
    expect(winActLine({ kind: "open", app: "Notepad", label: "notes" }, 123)).toBe(
      `open 123 ${Buffer.from("Notepad", "utf8").toString("base64")}`,
    );
  });

  it("maps Mac modifiers to PC keys", () => {
    expect(
      winActLine(
        { kind: "key", key: "tab", modifiers: ["command", "option", "shift"], label: "switch" },
        7,
      ),
    ).toBe("key 7 ctrl,alt,shift tab");
  });

  it("builds nothing for refused actions", () => {
    expect(winActLine({ kind: "click", x: 1, y: 2, label: "" }, 123)).toBeNull();
    expect(winActLine({ kind: "type", text: "a\nb", label: "t" }, 123)).toBeNull();
    expect(winActLine({ kind: "key", key: "f13", label: "no" }, 123)).toBeNull();
    expect(winActLine({ kind: "click", x: 10, y: 20, label: "Send" }, -1)).toBeNull();
  });
});

describe("the packaged app", () => {
  it("includes every file the desktop code requires", () => {
    const desktop = join(process.cwd(), "desktop");
    const { build } = JSON.parse(readFileSync(join(desktop, "package.json"), "utf8"));
    const required = readdirSync(desktop)
      .filter((file) => file.endsWith(".js") && build.files.includes(file))
      .flatMap((file) =>
        [...readFileSync(join(desktop, file), "utf8").matchAll(/require\("\.\/([\w-]+)"\)/g)].map(
          (match) => `${match[1]}.js`,
        ),
      );

    expect(required).toContain("operate.js");
    for (const file of required) expect(build.files).toContain(file);
  });
});
