import { describe, expect, it } from "vitest";
// The desktop app's own module (CommonJS, shipped with Persuna Desktop).
import { parseKeyLine } from "../../../desktop/mac-keys.js";

describe("the Mac talk-key monitor's lines", () => {
  it("reads the talk keys as the codes the hold key uses", () => {
    expect(parseKeyLine("d 61")).toEqual({ down: true, code: 3640 }); // right ⌥
    expect(parseKeyLine("u 61")).toEqual({ down: false, code: 3640 });
    expect(parseKeyLine("d 54")).toEqual({ down: true, code: 3676 }); // right ⌘
    expect(parseKeyLine("u 62\r")).toEqual({ down: false, code: 3613 }); // right ⌃
  });

  it("keeps every other key apart from the talk keys", () => {
    const left = parseKeyLine("d 58"); // left ⌥
    const e = parseKeyLine("d 14");
    expect(left?.code).not.toBe(3640);
    expect(e?.code).not.toBe(parseKeyLine("d 61")?.code);
    expect(left?.code).not.toBe(e?.code);
  });

  it("ignores anything that isn't a key line", () => {
    for (const line of ["", "x 61", "d", "d 61 extra", "d -1", "d 123456"]) {
      expect(parseKeyLine(line)).toBeNull();
    }
  });
});
