"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** The main sections. Earnings, the audit log and settings live in the account menu. */
const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/persona", label: "My Persuna" },
  { href: "/skills", label: "Skills" },
  { href: "/jobs", label: "Jobs" },
  { href: "/market", label: "Marketplace" },
  { href: "/projects", label: "Projects" },
];

/** Studio section links, with the current section marked. */
export function StudioNav() {
  const path = usePathname();
  return (
    <ul className="flex items-center gap-x-0.5">
      {NAV.map((item) => {
        const current =
          path === item.href ||
          path.startsWith(`${item.href}/`) ||
          (item.href === "/skills" && /^\/(runs|corrections)\//.test(path));
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={current ? "page" : undefined}
              className={`label-mono block whitespace-nowrap px-2.5 py-2 transition-colors ${
                current ? "text-accent" : "text-muted hover:text-foreground"
              }`}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
