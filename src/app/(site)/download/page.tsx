import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { MacChipNote, MacChoice } from "@/components/download/mac-chip";
import { Frame, SectionLabel } from "@/components/brand";
import { PersonaOrb } from "@/components/persona/orb";
import { buttonClass } from "@/components/ui";
import {
  RELEASES_URL,
  latestDesktopRelease,
  platformFromUserAgent,
  type DesktopFile,
} from "@/lib/desktop/releases";

export const metadata: Metadata = {
  title: "Download Persuna Desktop",
  description:
    "Persuna on your desktop: your assistant over your whole screen, for Mac (Apple silicon and Intel) and Windows.",
};

export const revalidate = 600;

function DownloadButton({
  file,
  label,
  primary,
}: {
  file: DesktopFile | undefined;
  label: string;
  primary?: boolean;
}) {
  if (!file) return null;
  return (
    <a
      href={file.url}
      className={`${buttonClass(primary ? "primary" : "secondary", "md")} w-full justify-between`}
      download
    >
      <span>{label}</span>
      <span className="opacity-70">{file.sizeMb} MB</span>
    </a>
  );
}

export default async function DownloadPage() {
  const [release, ua] = await Promise.all([
    latestDesktopRelease(),
    headers().then((h) => h.get("user-agent") ?? ""),
  ]);
  const platform = platformFromUserAgent(ua);
  const f = release?.files ?? {};
  const mac = (
    <MacChoice
      apple={
        <DownloadButton
          file={f.macArm}
          label="Mac · Apple silicon (M1 and later)"
          primary={platform === "mac"}
        />
      }
      intel={<DownloadButton file={f.macIntel} label="Mac · Intel" />}
    />
  );
  const windows = (
    <>
      <DownloadButton file={f.winX64} label="Windows · most PCs" primary={platform === "windows"} />
      <DownloadButton file={f.winArm} label="Windows · Arm laptops" />
    </>
  );

  return (
    <>
      <section className="relative overflow-hidden">
        <Frame className="relative">
          <div aria-hidden className="halftone absolute inset-0" />
          <div className="relative grid gap-12 px-4 pb-20 pt-16 sm:px-8 lg:grid-cols-[1.1fr_1fr] lg:items-center">
            <div>
              <SectionLabel index="↓">Persuna Desktop</SectionLabel>
              <h1 className="mt-5 font-display text-[clamp(2.4rem,6vw,4.25rem)] font-medium leading-[1] tracking-[-0.04em]">
                Your Persuna, over your whole screen
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
                It floats above every app, even full-screen ones, while clicks pass straight
                through. Talk to it, hand it tasks, and when you allow it, let it learn from any app
                you work in, without sharing a window each time.
              </p>
              <div className="mt-8 grid max-w-md gap-2">
                {release ? (
                  platform === "windows" ? (
                    <>
                      {windows}
                      {mac}
                    </>
                  ) : (
                    <>
                      {mac}
                      {windows}
                    </>
                  )
                ) : (
                  <a href={RELEASES_URL} className={buttonClass("primary", "md")}>
                    See the downloads on GitHub
                  </a>
                )}
              </div>
              <p className="mt-4 max-w-md text-sm text-muted">
                {platform === "mac" && <MacChipNote />}
                {release && (
                  <>
                    {" "}
                    Version {release.version}.{" "}
                    <a href={release.url} className="underline hover:text-foreground">
                      All files and release notes
                    </a>
                    .
                  </>
                )}
              </p>
            </div>
            <div className="hatch relative flex min-h-80 items-center justify-center rounded-md border border-line">
              <div className="flex flex-col items-center gap-3">
                <PersonaOrb look="plum" size={150} />
                <p className="label-mono text-muted">Say &ldquo;Hey Persuna&rdquo;</p>
              </div>
            </div>
          </div>
        </Frame>
      </section>

      <section className="border-t border-line bg-card">
        <Frame className="grid gap-px bg-line md:grid-cols-3">
          {[
            [
              "Open it the first time",
              "The app isn't signed with an Apple or Microsoft certificate yet. On a Mac, drag Persuna to Applications, then right-click it and choose Open, then Open again. On Windows, if SmartScreen warns, choose More info, then Run anyway. After that it opens normally.",
            ],
            [
              "Permission once, not sharing each time",
              "The first time you turn watching on, your Persuna asks what to watch (your whole screen or one app) and can remember it. On a Mac, macOS also asks once for Screen Recording. It only watches while watching is on, keeps no screenshots, and never sees itself.",
            ],
            [
              "Lives in your menu bar",
              "Your Persuna sits in the menu bar (Mac) or system tray (Windows), not the Dock or taskbar. Show or hide it, change what it watches, open it at login or quit, all from its icon.",
            ],
          ].map(([title, body]) => (
            <div key={title} className="bg-card p-6 sm:p-8">
              <p className="font-display text-xl font-medium tracking-[-0.02em]">{title}</p>
              <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
            </div>
          ))}
        </Frame>
      </section>

      <section className="border-t border-line">
        <Frame className="px-4 py-14 text-center sm:px-8">
          <p className="text-muted">No account yet? The app signs in with your PERSUNA account.</p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Link href="/sign-up" className={buttonClass("primary", "md")}>
              Create an account
            </Link>
            <Link href="/sign-in" className={buttonClass("secondary", "md")}>
              Sign in
            </Link>
          </div>
        </Frame>
      </section>
    </>
  );
}
