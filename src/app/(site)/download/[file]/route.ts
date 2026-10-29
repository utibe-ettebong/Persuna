import { NextResponse } from "next/server";
import { DOWNLOAD_SLUGS, latestDesktopRelease } from "@/lib/desktop/releases";

/**
 * /download/mac-arm64 (and mac-x64, win-x64, win-arm64): starts the download
 * of the latest Persuna Desktop for that machine. The download page links
 * here, so people get the file without visiting where it's hosted.
 */
export async function GET(request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const platform = DOWNLOAD_SLUGS[file as keyof typeof DOWNLOAD_SLUGS];
  // The newest release right now; the cached answer only if GitHub doesn't reply.
  const release = platform
    ? ((await latestDesktopRelease({ fresh: true })) ?? (await latestDesktopRelease()))
    : null;
  const target = platform && release?.files[platform];
  if (!target) {
    return NextResponse.redirect(new URL("/download?unavailable=1", request.url), 303);
  }
  return NextResponse.redirect(target.url, 302);
}
