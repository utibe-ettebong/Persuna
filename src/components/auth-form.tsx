"use client";

import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/auth/client";
import { buttonClass, Field, inputClass } from "./ui";

/** Sign-in and sign-up, with errors shown inline. Sends the user on to `next`. */
export function AuthForm({ mode, next }: { mode: "sign-in" | "sign-up"; next: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Only same-site paths, so a crafted link can't bounce users elsewhere after sign-in.
  const destination = next.startsWith("/") && !next.startsWith("//") ? next : "/skills";

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const result =
      mode === "sign-up"
        ? await authClient.signUp.email({
            name: String(form.get("name") ?? "").trim(),
            email,
            password,
          })
        : await authClient.signIn.email({ email, password });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "That didn't work. Check your details and try again.");
      return;
    }
    // A full page load: the client router may still hold "redirect to sign-in"
    // for pages visited while signed out.
    window.location.assign(destination);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" aria-busy={pending}>
      {mode === "sign-up" && (
        <Field label="Your name">
          <input
            name="name"
            required
            minLength={2}
            maxLength={80}
            autoComplete="name"
            className={inputClass}
          />
        </Field>
      )}
      <Field label="Email">
        <input name="email" type="email" required autoComplete="email" className={inputClass} />
      </Field>
      <Field label="Password" hint={mode === "sign-up" ? "at least 10 characters" : undefined}>
        <input
          name="password"
          type="password"
          required
          minLength={mode === "sign-up" ? 10 : 1}
          autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
          className={inputClass}
        />
      </Field>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <button type="submit" disabled={pending} className={`${buttonClass("primary", "md")} w-full`}>
        {pending ? "One moment…" : mode === "sign-up" ? "Create account" : "Sign in"}
      </button>
      <p className="text-center text-sm text-muted">
        {mode === "sign-up" ? (
          <>
            Already have an account?{" "}
            <Link
              href={`/sign-in?next=${encodeURIComponent(destination)}`}
              className="text-accent underline"
            >
              Sign in
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link
              href={`/sign-up?next=${encodeURIComponent(destination)}`}
              className="text-accent underline"
            >
              Create an account
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
