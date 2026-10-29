import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Frame, SectionLabel } from "@/components/brand";
import { AuthForm } from "@/components/auth-form";
import { getUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Create your account" };

type Params = { searchParams: Promise<{ next?: string }> };

export default async function SignUpPage({ searchParams }: Params) {
  const { next = "/dashboard" } = await searchParams;
  if (await getUser())
    redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
  return (
    <Frame className="relative">
      <div aria-hidden className="halftone absolute inset-0" />
      <div className="relative flex min-h-[70vh] items-center justify-center px-4 py-16">
        <div className="w-full max-w-md rounded-md border border-line bg-card p-8 shadow-[0_20px_60px_-30px_rgba(29,22,29,0.35)]">
          <SectionLabel>Persuna studio</SectionLabel>
          <h1 className="mt-3 font-display text-3xl font-medium tracking-[-0.03em]">
            Create your account
          </h1>
          <p className="mt-2 text-sm text-muted">
            Train skills on your own work, approve what they draft, and rent them out.
          </p>
          <div className="mt-6">
            <AuthForm mode="sign-up" next={next} />
          </div>
        </div>
      </div>
    </Frame>
  );
}
