import type { Metadata } from "next";
import { headers } from "next/headers";
import { OpenDesktop } from "@/components/desktop/open-desktop";
import { PersonaOrb } from "@/components/persona/orb";
import { auth } from "@/lib/auth";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Sign in to Persona Desktop" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ state?: string }> };

/**
 * Persona Desktop's "Continue in your browser": once signed in here, the
 * browser makes a one-time token and hands it back to the app through a
 * persuna:// link. The state the app chose comes back with it, so the app only
 * accepts the sign-in it started.
 */
export default async function ConnectDesktopPage({ searchParams }: Props) {
  const { state = "" } = await searchParams;
  const valid = /^[\w-]{16,64}$/.test(state);
  const user = await requireUser(`/desktop/connect?state=${encodeURIComponent(state)}`);
  const token = valid
    ? (await auth().api.generateOneTimeToken({ headers: await headers() })).token
    : null;
  const link = token
    ? `persuna://signed-in?token=${encodeURIComponent(token)}&state=${encodeURIComponent(state)}`
    : null;

  return (
    <main className="persona-backdrop flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <PersonaOrb look="plum" size={96} />
      {link ? (
        <>
          <h1 className="mt-5 font-display text-3xl font-medium tracking-[-0.03em]">
            Signed in as {user.name || user.email}
          </h1>
          <p className="mt-2 max-w-sm text-sm text-muted">
            Persona Desktop is picking it up. If your browser asks, allow it to open Persuna. You
            can close this tab afterwards.
          </p>
          <OpenDesktop href={link} />
        </>
      ) : (
        <>
          <h1 className="mt-5 font-display text-3xl font-medium tracking-[-0.03em]">
            Start from the app
          </h1>
          <p className="mt-2 max-w-sm text-sm text-muted">
            This link didn&apos;t come from Persona Desktop. Open the app and choose &ldquo;Continue
            in your browser&rdquo;.
          </p>
        </>
      )}
    </main>
  );
}
