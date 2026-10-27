import type { Metadata } from "next";
import { CompanionMount } from "@/components/persona/companion-mount";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Companion" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ overlay?: string }> };

/**
 * Persona on its own page. With ?overlay=1 (Persona Desktop) it roams a
 * see-through layer over the whole screen; otherwise it fills a narrow
 * window as a column.
 */
export default async function CompanionPage({ searchParams }: Props) {
  const { overlay } = await searchParams;
  const user = await requireUser(overlay ? "/companion?overlay=1" : "/companion");
  return (
    <main className="h-screen">
      {/* See-through, so the desktop shows behind Persona. */}
      <style>{"html,body{background:transparent!important}"}</style>
      <CompanionMount userId={user.id} standalone={!overlay} overlay={Boolean(overlay)} />
    </main>
  );
}
