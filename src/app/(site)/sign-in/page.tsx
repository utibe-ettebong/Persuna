import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Frame, SectionLabel } from "@/components/brand";
import { AuthForm } from "@/components/auth-form";
import { getUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

type Params = { searchParams: Promise<{ next?: string }> };

export default async function SignInPage({ searchParams }: Params) {
  const { next = "/skills" } = await searchParams;
  if (await getUser()) redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/skills");
  return (
    <Frame className="relative">
      <div aria-hidden className="halftone absolute inset-0" />
      <div className="relative flex min-h-[70vh] items-center justify-center px-4 py-16">
        <div className="w-full max-w-md rounded-md border border-line bg-card p-8 shadow-[0_20px_60px_-30px_rgba(29,22,29,0.35)]">
          <SectionLabel>Persuna studio</SectionLabel>
          <h1 className="mt-3 font-display text-3xl font-medium tracking-[-0.03em]">Sign in</h1>
          <p className="mt-2 text-sm text-muted">
            Welcome back. Your skills, jobs and earnings are waiting.
          </p>
          <div className="mt-6">
            <AuthForm mode="sign-in" next={next} />
          </div>
        </div>
      </div>
    </Frame>
  );
}
