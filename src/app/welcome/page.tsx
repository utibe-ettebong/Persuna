import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DesktopWelcome } from "@/components/desktop/welcome";
import { getUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Welcome" };
export const dynamic = "force-dynamic";

/** Persuna Desktop's first-run window: hello, then sign in or sign up. */
export default async function WelcomePage() {
  if (await getUser()) redirect("/companion?overlay=1");
  return <DesktopWelcome />;
}
