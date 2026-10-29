import { describe, expect, it } from "vitest";
// The desktop app's own module (CommonJS, shipped with Persuna Desktop).
import {
  canReplaceAt,
  isNewer,
  parseUpdateInfo,
  pickMacZip,
} from "../../../desktop/update-info.js";

const LATEST_MAC = `version: 0.7.0
files:
  - url: Persuna-0.7.0-mac-x64.zip
    sha512: aGVsbG8teDY0
    size: 120000000
  - url: Persuna-0.7.0-mac-arm64.zip
    sha512: aGVsbG8tYXJt
    size: 115000000
  - url: Persuna-0.7.0-mac-arm64.dmg
    sha512: ZG1n
    size: 118000000
path: Persuna-0.7.0-mac-x64.zip
sha512: aGVsbG8teDY0
releaseDate: '2026-10-30T10:00:00.000Z'
`;

describe("desktop updates", () => {
  it("compares versions", () => {
    expect(isNewer("0.6.10", "0.6.9")).toBe(true);
    expect(isNewer("0.7.0", "0.6.1")).toBe(true);
    expect(isNewer("0.6.1", "0.6.1")).toBe(false);
    expect(isNewer("0.6.0", "0.6.1")).toBe(false);
    expect(isNewer("v1.0.0", "0.9.9")).toBe(true);
    expect(isNewer("0.7.0-beta", "0.7.0")).toBe(false);
  });

  it("reads the update file and picks the zip for the chip", () => {
    const info = parseUpdateInfo(LATEST_MAC)!;
    expect(info.version).toBe("0.7.0");
    expect(info.files).toHaveLength(3);
    expect(pickMacZip(info, "arm64")).toEqual({
      url: "Persuna-0.7.0-mac-arm64.zip",
      sha512: "aGVsbG8tYXJt",
      size: 115000000,
    });
    expect(pickMacZip(info, "x64")?.url).toBe("Persuna-0.7.0-mac-x64.zip");
    expect(parseUpdateInfo("not an update file")).toBeNull();
  });

  it("only replaces an app installed somewhere it can write", () => {
    expect(canReplaceAt("/Applications/Persuna.app", true)).toBe(true);
    expect(canReplaceAt("/Applications/Persuna.app", false)).toBe(false);
    expect(canReplaceAt("/Volumes/Persuna 0.7.0/Persuna.app", true)).toBe(false);
    expect(canReplaceAt("/private/var/folders/x/AppTranslocation/ABC/d/Persuna.app", true)).toBe(
      false,
    );
  });
});
