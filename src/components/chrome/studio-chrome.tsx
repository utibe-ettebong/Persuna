import Link from "next/link";
import { Logo } from "@/components/brand";
import { AccountMenu } from "@/components/account-menu";
import { MobileNav } from "@/components/chrome/mobile-nav";
import { CompanionMount } from "@/components/persona/companion-mount";
import { StudioNav } from "@/components/studio-nav";
import { modelProvider } from "@/env";
import type { SessionUser } from "@/lib/auth/session";
import { ensureHandle } from "@/lib/persona/service";

/**
 * The signed-in app: a sidebar with every section (a drawer on phones), a
 * slim top bar with the account menu, the page, and the companion.
 */
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
    <div className="flex min-h-screen flex-1">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-card lg:flex">
        <div className="flex h-14 items-center px-6">
          <Logo href="/dashboard" />
        </div>
        <nav aria-label="Studio" className="flex-1 overflow-y-auto px-3 py-4">
          <StudioNav isAdmin={user.isAdmin} />
        </nav>
        <div className="border-t border-line p-4">
          <Link
            href="/download"
            className="block rounded-md bg-accent-soft p-3 text-sm hover:bg-accent-soft/70"
          >
            <span className="font-medium text-accent">Persuna Desktop</span>
            <span className="block text-xs text-muted">Hold a key and talk, from any app.</span>
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-background/90 px-4 backdrop-blur sm:px-8">
          <MobileNav isAdmin={user.isAdmin} logo={<Logo href="/dashboard" />} />
          <div className="lg:hidden">
            <Logo href="/dashboard" />
          </div>
          <div className="ml-auto flex items-center gap-3">
            {mock && (
              <Link
                href={user.isAdmin ? "/settings" : "/skills"}
                className="label-mono rounded-sm border border-warn/40 bg-warn/8 px-2 py-1 text-warn"
                title="No model API key is set. Drafts are rough and scores are text overlap. Set EXTRACT_API_KEY or MODEL_PROVIDER=live for real models."
              >
                Mock models
              </Link>
            )}
            <AccountMenu
              name={user.name}
              email={user.email}
              isAdmin={user.isAdmin}
              profileHref={profileHref}
            />
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-8">{children}</main>
      </div>
      <CompanionMount userId={user.id} userName={user.name} />
    </div>
  );
}
