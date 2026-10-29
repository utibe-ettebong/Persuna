import { SiteChrome } from "@/components/chrome/site-chrome";
import { StudioChrome } from "@/components/chrome/studio-chrome";
import { getUser } from "@/lib/auth/session";

/**
 * Pages anyone may open (the marketplace and the projects board). Signed-in
 * people see them inside the studio; everyone else inside the public site.
 * Acting on them (renting, posting, proposing) still needs an account.
 */
export default async function OpenLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await getUser();
  if (user) return <StudioChrome user={user}>{children}</StudioChrome>;
  return (
    <SiteChrome>
      <div className="mx-auto w-full max-w-6xl border-x border-line px-4 py-10 sm:px-8">
        {children}
      </div>
    </SiteChrome>
  );
}
