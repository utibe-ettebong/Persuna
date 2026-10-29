import { describe, expect, it } from "vitest";
import { DOWNLOAD_SLUGS, downloadPath, pickDesktopFiles, platformFromUserAgent } from "./releases";

const asset = (name: string, mb: number) => ({
  name,
  browser_download_url: `https://example.org/${name}`,
  size: mb * 1048576,
});

describe("pickDesktopFiles", () => {
  it("takes one installer per platform and ignores zips and the combined Windows build", () => {
    const files = pickDesktopFiles([
      asset("Persuna-0.2.1-mac-arm64.dmg", 124),
      asset("Persuna-0.2.1-mac-arm64.zip", 119),
      asset("Persuna-0.2.1-mac-x64.dmg", 130),
      asset("Persuna-0.2.1-win.exe", 223),
      asset("Persuna-0.2.1-win-x64.exe", 114),
      asset("Persuna-0.2.1-win-arm64.exe", 109),
    ]);
    expect(
      Object.fromEntries(Object.entries(files).map(([k, v]) => [k, `${v.name} ${v.sizeMb}`])),
    ).toEqual({
      macArm: "Persuna-0.2.1-mac-arm64.dmg 124",
      macIntel: "Persuna-0.2.1-mac-x64.dmg 130",
      winX64: "Persuna-0.2.1-win-x64.exe 114",
      winArm: "Persuna-0.2.1-win-arm64.exe 109",
    });
  });
});

describe("platformFromUserAgent", () => {
  it("recognises Mac and Windows", () => {
    expect(
      platformFromUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"),
    ).toBe("mac");
    expect(platformFromUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows");
    expect(platformFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe(
      "other",
    );
  });
});

describe("download links", () => {
  it("are Persuna's own addresses, one per installer", () => {
    expect(downloadPath("macArm")).toBe("/download/mac-arm64");
    expect(downloadPath("macIntel")).toBe("/download/mac-x64");
    expect(downloadPath("winX64")).toBe("/download/win-x64");
    expect(downloadPath("winArm")).toBe("/download/win-arm64");
    expect(Object.keys(DOWNLOAD_SLUGS)).toHaveLength(4);
  });
});
