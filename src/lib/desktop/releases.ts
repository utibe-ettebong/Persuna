import { z } from "zod";

/**
 * Persuna Desktop downloads, read from the repository's latest GitHub
 * release (published by .github/workflows/desktop.yml). Cached for two
 * minutes; when GitHub can't be reached the page links to the releases list.
 */
export const RELEASES_URL = "https://github.com/utibe-ettebong/Persuna/releases/latest";
const API_URL = "https://api.github.com/repos/utibe-ettebong/Persuna/releases/latest";

const release = z.object({
  tag_name: z.string(),
  html_url: z.string(),
  published_at: z.string().nullable(),
  assets: z.array(
    z.object({ name: z.string(), browser_download_url: z.string(), size: z.number() }),
  ),
});

export type DesktopPlatform = "macArm" | "macIntel" | "winX64" | "winArm";

export interface DesktopFile {
  name: string;
  url: string;
  sizeMb: number;
}

export interface DesktopRelease {
  version: string;
  url: string;
  publishedAt: string | null;
  files: Partial<Record<DesktopPlatform, DesktopFile>>;
}

const PATTERNS: Record<DesktopPlatform, RegExp> = {
  macArm: /-mac-arm64\.dmg$/,
  macIntel: /-mac-x64\.dmg$/,
  winX64: /-win-x64\.exe$/,
  winArm: /-win-arm64\.exe$/,
};

/** Picks the one installer each platform needs out of a release's files. */
export function pickDesktopFiles(
  assets: { name: string; browser_download_url: string; size: number }[],
): DesktopRelease["files"] {
  const files: DesktopRelease["files"] = {};
  for (const [platform, re] of Object.entries(PATTERNS) as [DesktopPlatform, RegExp][]) {
    const a = assets.find((x) => re.test(x.name));
    if (a)
      files[platform] = {
        name: a.name,
        url: a.browser_download_url,
        sizeMb: Math.round(a.size / 1048576),
      };
  }
  return files;
}

export async function latestDesktopRelease(): Promise<DesktopRelease | null> {
  try {
    const res = await fetch(API_URL, {
      headers: { accept: "application/vnd.github+json" },
      next: { revalidate: 120 },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const parsed = release.safeParse(await res.json());
    if (!parsed.success) return null;
    return {
      version: parsed.data.tag_name.replace(/^desktop-v/, ""),
      url: parsed.data.html_url,
      publishedAt: parsed.data.published_at,
      files: pickDesktopFiles(parsed.data.assets),
    };
  } catch {
    return null;
  }
}

/** Mac or Windows, from the browser's user agent. Mac chips can't be told apart here. */
export function platformFromUserAgent(ua: string): "mac" | "windows" | "other" {
  if (/Windows/i.test(ua)) return "windows";
  if (/Macintosh|Mac OS X/i.test(ua) && !/iPhone|iPad/i.test(ua)) return "mac";
  return "other";
}
