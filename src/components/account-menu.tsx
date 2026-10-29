"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth/client";
import { initialsOf } from "@/lib/profile/rules";

/**
 * The account button at the end of the studio header: your initials, opening
 * a menu with who you're signed in as, your profile, the less-used pages and
 * signing out. Keeps the header to one short row.
 */
export function AccountMenu({
  name,
  email,
  isAdmin,
  profileHref,
}: {
  name: string;
  email: string;
  isAdmin: boolean;
  profileHref: string | null;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  const links = [
    { href: "/dashboard", label: "Dashboard" },
    ...(profileHref ? [{ href: profileHref, label: "Your public profile" }] : []),
    { href: "/profile", label: "Edit profile and portfolio" },
    { href: "/earnings", label: "Earnings" },
    { href: "/audit", label: "Audit log" },
    ...(isAdmin ? [{ href: "/settings", label: "Models & keys" }] : []),
    { href: "/download", label: "Get the desktop app" },
  ];
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${name || email}`}
        onClick={() => setOpen(!open)}
        className="grid h-8 w-8 place-items-center rounded-full bg-accent text-[11px] font-semibold text-accent-ink ring-offset-2 ring-offset-background hover:ring-2 hover:ring-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {initialsOf(name, email)}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+8px)] z-30 w-64 rounded-md border border-line bg-card p-1.5 shadow-[0_12px_32px_-14px_rgba(29,22,29,0.35)]"
        >
          <div className="border-b border-line px-3 pb-2.5 pt-1.5">
            <p className="truncate text-sm font-medium">{name || "Your account"}</p>
            <p className="truncate text-xs text-muted" title={email}>
              {email}
            </p>
          </div>
          <ul className="py-1">
            {links.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className="block rounded-sm px-3 py-1.5 text-sm text-foreground hover:bg-accent-soft hover:text-accent"
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              await authClient.signOut();
              // A full page load drops pages cached while signed in.
              // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- the full load is the point
              window.location.assign("/");
            }}
            className="w-full rounded-sm border-t border-line px-3 py-2 text-left text-sm text-muted hover:text-foreground"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
