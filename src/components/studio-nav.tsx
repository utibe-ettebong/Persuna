"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  href: string;
  label: string;
  /** Which group of the sidebar it sits in (default: Workspace). */
  section?: "Workspace" | "Marketplace" | "Account" | "Admin";
  adminOnly?: boolean;
}

/** Every studio section, grouped in the sidebar. */
export const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/persuna", label: "My Persuna" },
  { href: "/skills", label: "Skills" },
  { href: "/jobs", label: "Jobs" },
  { href: "/team", label: "Team" },
  { href: "/market", label: "Marketplace", section: "Marketplace" },
  { href: "/projects", label: "Projects", section: "Marketplace" },
  { href: "/earnings", label: "Earnings", section: "Marketplace" },
  { href: "/profile", label: "Profile", section: "Account" },
  { href: "/audit", label: "Audit log", section: "Account" },
  { href: "/settings", label: "Models & keys", section: "Account", adminOnly: true },
  { href: "/admin", label: "Admin", section: "Admin", adminOnly: true },
];

const SECTIONS = ["Workspace", "Marketplace", "Account", "Admin"] as const;

/** Small line icons, one per section of the studio. */
const ICONS: Record<string, string> = {
  "/dashboard": "M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z",
  "/persuna": "M12 3a7 7 0 0 1 7 7c0 4-3 7-7 11-4-4-7-7-7-11a7 7 0 0 1 7-7zM9.5 10h.01M14.5 10h.01",
  "/skills": "M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z",
  "/jobs": "M4 7h16v12H4zM9 7V5h6v2M4 12h16",
  "/market": "M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9h16M9 20v-6h6v6",
  "/projects": "M4 5h6l2 2h8v12H4zM8 13h8",
  "/earnings":
    "M12 3v18M16.5 7.5c0-1.7-2-3-4.5-3s-4.5 1.3-4.5 3 2 2.6 4.5 3 4.5 1.3 4.5 3-2 3-4.5 3-4.5-1.3-4.5-3",
  "/profile": "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6",
  "/audit": "M6 3h9l4 4v14H6zM9 11h7M9 15h7M9 7h3",
  "/settings":
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-1-3-2 .5-1.5-1.5.5-2-3-1-1 2h-2l-1-2-3 1 .5 2L6 9.5 4 9l-1 3 2 1v2l-2 1 1 3 2-.5 1.5 1.5-.5 2 3 1 1-2h2l1 2 3-1-.5-2 1.5-1.5 2 .5 1-3-2-1z",
  "/admin": "M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6zM9 12l2 2 4-4",
};

function NavIcon({ href }: { href: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden className="shrink-0">
      <path
        d={ICONS[href] ?? "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The studio's sidebar navigation, in groups, with the current page marked. */
export function StudioNav({ isAdmin, onNavigate }: { isAdmin: boolean; onNavigate?: () => void }) {
  const path = usePathname();
  const items = NAV.filter((item) => isAdmin || !item.adminOnly);
  return (
    <div className="space-y-6">
      {SECTIONS.map((section) => {
        const list = items.filter((i) => (i.section ?? "Workspace") === section);
        if (!list.length) return null;
        return (
          <div key={section}>
            <p className="label-mono px-3 pb-1.5 text-faint">{section}</p>
            <ul className="space-y-0.5">
              {list.map((item) => {
                const current =
                  path === item.href ||
                  path.startsWith(`${item.href}/`) ||
                  (item.href === "/skills" && /^\/(runs|corrections)\//.test(path));
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={current ? "page" : undefined}
                      className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                        current
                          ? "bg-accent-soft font-medium text-accent"
                          : "text-muted hover:bg-subtle hover:text-foreground"
                      }`}
                    >
                      <NavIcon href={item.href} />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
