import type { Metadata } from "next";
import { DesktopSetup } from "@/components/desktop/setup";
import { getUser } from "@/lib/auth/session";
import { companion } from "@/lib/persuna/service";

export const metadata: Metadata = { title: "Set up Persuna" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ signin?: string }> };

/**
 * Persuna Desktop's setup window: sign in (in the browser, or here), the
 * Mac permissions, a mic test, practising hold-to-talk, getting to know each
 * other, and a first skill to learn.
 */
export default async function DesktopSetupPage({ searchParams }: Props) {
  const { signin } = await searchParams;
  const user = await getUser();
  const persuna = user ? await companion(user.id) : null;
  return (
    <DesktopSetup
      user={user ? { name: user.name } : null}
      persuna={
        persuna
          ? {
              name: persuna.profile.name,
              avatar: persuna.profile.avatar,
              setupDone: persuna.profile.setupDone,
            }
          : null
      }
      skills={persuna?.skills.map((s) => ({ slug: s.slug, name: s.name })) ?? []}
      signInExpired={signin === "expired"}
    />
  );
}
