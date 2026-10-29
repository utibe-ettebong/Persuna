import Link from "next/link";
import { Logo } from "@/components/brand";
import { CompanionMount } from "@/components/persona/companion-mount";
import { StudioNav } from "@/components/studio-nav";
import { AccountMenu } from "@/components/account-menu";
import { modelProvider } from "@/env";
import type { SessionUser } from "@/lib/auth/session";
import { ensureHandle } from "@/lib/persona/service";

/** The signed-in studio frame: framed page, mono navigation, mock-model notice, the companion. */
export async function StudioChrome({
  user,
  children,
}: {
  user: SessionUser;
  children: React.ReactNode;
}) {
  const mock = modelProvider() === "mock";
  // Everyone gets a public profile address the first time it's needed.
  const handle = await ensureHandle(user.id).catch(() => null);
  const profileHref = handle ? `/personas/${handle}` : null;
  return (
    <>
      <header className="sticky top-0 z-20 border-b border-line bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 border-x border-line px-4 sm:px-6">
          <div className="py-2.5">
            <Logo href="/dashboard" />
          </div>
          <nav
            aria-label="Studio"
            className="no-scrollbar order-last -mx-4 w-[calc(100%+2rem)] overflow-x-auto border-t border-line px-1 sm:-mx-6 sm:w-[calc(100%+3rem)] lg:order-none lg:mx-0 lg:w-auto lg:flex-1 lg:overflow-visible lg:border-t-0 lg:px-0"
          >
            <StudioNav />
          </nav>
          <div className="ml-auto flex items-center gap-3 py-2.5">
            {mock && (
              <Link
                href={user.isAdmin ? "/settings" : "/skills"}
                className="label-mono rounded-sm border border-warn/40 bg-warn/8 px-2 py-1 text-warn"
                title="No model API key is set. Drafts are rough and scores are text overlap. Set EXTRACT_API_KEY or MODEL_PROVIDER=live for real models."
              >
                Mock models
              </Link>
            )}
            <Link
              href="/download"
              className="label-mono hidden whitespace-nowrap rounded-sm border border-accent/40 bg-accent-soft px-2 py-1 text-accent hover:bg-accent-soft/70 xl:inline"
              title="Persuna Desktop for Mac and Windows"
            >
              Get the app
            </Link>
            <AccountMenu
              name={user.name}
              email={user.email}
              isAdmin={user.isAdmin}
              profileHref={profileHref}
            />
          </div>
        </div>
      </header>
      <div className="flex flex-1">
        <div aria-hidden className="hatch hidden flex-1 lg:block" />
        <main className="w-full max-w-6xl flex-1 border-x border-line bg-background px-4 py-10 sm:px-8 lg:flex-none">
          {children}
        </main>
        <div aria-hidden className="hatch hidden flex-1 lg:block" />
      </div>
      <CompanionMount userId={user.id} userName={user.name} />
    </>
  );
}
