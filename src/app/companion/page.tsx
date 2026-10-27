import type { Metadata } from "next";
import { CompanionMount } from "@/components/persona/companion-mount";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Companion" };
export const dynamic = "force-dynamic";

/**
 * Persona on its own, filling the window. The desktop app loads this page in
 * a small always-on-top window; it also works in a narrow browser window.
 */
export default async function CompanionPage() {
  const user = await requireUser("/companion");
  return (
    <main className="h-screen">
      {/* Lets the desktop app's see-through window show the desktop behind Persona. */}
      <style>{"html,body{background:transparent!important}"}</style>
      <CompanionMount userId={user.id} standalone />
    </main>
  );
}
