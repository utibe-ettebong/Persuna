"use client";

import { useEffect, useState } from "react";
import { StudioNav } from "@/components/studio-nav";

/** On small screens the sidebar opens as a drawer from the menu button. */
export function MobileNav({ isAdmin, logo }: { isAdmin: boolean; logo: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);
  return (
    <>
      <button
        type="button"
        aria-label="Open the menu"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="grid h-9 w-9 place-items-center rounded-md text-muted hover:bg-subtle hover:text-foreground lg:hidden"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
          <path
            d="M4 7h16M4 12h16M4 17h16"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </button>
      {open && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
        >
          <button
            type="button"
            aria-label="Close the menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-foreground/30"
          />
          <aside className="relative flex h-full w-72 max-w-[85vw] flex-col gap-6 overflow-y-auto border-r border-line bg-card p-4">
            <div className="px-3 pt-1">{logo}</div>
            <StudioNav isAdmin={isAdmin} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
    </>
  );
}
