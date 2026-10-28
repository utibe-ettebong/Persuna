"use client";

import { useEffect } from "react";

/** Hands the sign-in to Persona Desktop straight away, with a button in case the browser asks first. */
export function OpenDesktop({ href }: { href: string }) {
  useEffect(() => {
    window.location.href = href;
  }, [href]);
  return (
    <a href={href} className="mt-6 rounded-full bg-accent px-5 py-3 text-sm text-accent-ink">
      Open Persuna
    </a>
  );
}
