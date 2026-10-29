import { z } from "zod";

/**
 * Persuna Desktop downloads, read from the repository's latest GitHub
 * release (published by .github/workflows/desktop.yml). Cached for two
 * minutes; when GitHub can't be reached the page says downloads are briefly
 * unavailable. Visitors only ever see /download/<slug> links.
 */
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

/** The addresses the download page links to (/download/<slug>), one per installer. */
export const DOWNLOAD_SLUGS = {
  "mac-arm64": "macArm",
  "mac-x64": "macIntel",
  "win-x64": "winX64",
  "win-arm64": "winArm",
} as const satisfies Record<string, DesktopPlatform>;

/** /download/<slug> for a platform. */
export function downloadPath(platform: DesktopPlatform): string {
  const slug = Object.entries(DOWNLOAD_SLUGS).find(([, p]) => p === platform)![0];
  return `/download/${slug}`;
}

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

/**
 * The newest release. `fresh` asks GitHub now instead of using the cached
 * answer (download links use it, so nobody is sent an older version).
 */
export async function latestDesktopRelease(
  options: { fresh?: boolean } = {},
): Promise<DesktopRelease | null> {
  try {
    const res = await fetch(API_URL, {
      headers: { accept: "application/vnd.github+json" },
      ...(options.fresh ? { cache: "no-store" as const } : { next: { revalidate: 120 } }),
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
