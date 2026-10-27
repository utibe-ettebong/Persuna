import Link from "next/link";
import { Logo, Mark } from "@/components/brand";
import { buttonClass } from "@/components/ui";

const LINKS = [
  { href: "/#how", label: "How it works" },
  { href: "/#trust", label: "Trust" },
  { href: "/#rent", label: "Rent a skill" },
  { href: "/#faq", label: "FAQ" },
];

/** Public pages: the landing page and employer approval links. */
export default function SiteLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-6 border-x border-line px-4 py-2.5 sm:px-6">
          <Logo />
          <nav aria-label="Site" className="hidden flex-1 md:block">
            <ul className="flex items-center gap-1">
              {LINKS.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="label-mono px-3 py-2 text-muted hover:text-foreground"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/sign-in"
              className="label-mono hidden px-2 text-muted hover:text-foreground sm:inline"
            >
              Sign in
            </Link>
            <Link href="/sign-up" className={buttonClass("primary")}>
              Try it free
            </Link>
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </>
  );
}

function SiteFooter() {
  const columns = [
    {
      title: "Studio",
      links: [
        ["Skills", "/skills"],
        ["Jobs", "/jobs"],
        ["Earnings", "/earnings"],
        ["Audit log", "/audit"],
      ],
    },
    {
      title: "Marketplace",
      links: [
        ["Browse skills", "/market"],
        ["How renting works", "/#rent"],
      ],
    },
    {
      title: "Principles",
      links: [
        ["The human approves", "/#trust"],
        ["Method, not material", "/#safeguards"],
        ["FAQ", "/#faq"],
      ],
    },
  ];
  return (
    <footer className="plum-band relative overflow-hidden">
      <div className="mx-auto max-w-6xl px-4 pb-10 pt-16 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="flex items-center gap-2 font-display text-lg font-semibold">
              <Mark /> Persuna
            </p>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-white/60">
              Your method, multiplied. Built for the Meta Global AI Developer Hackathon.
            </p>
          </div>
          {columns.map((c) => (
            <div key={c.title}>
              <p className="text-sm text-white/50">{c.title}</p>
              <ul className="mt-4 space-y-2">
                {c.links.map(([label, href]) => (
                  <li key={href}>
                    <Link href={href} className="label-mono text-white/90 hover:text-white">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p
          aria-hidden
          className="mt-16 select-none text-center font-display text-[clamp(4rem,17vw,15rem)] font-semibold leading-none tracking-[-0.05em] text-transparent [-webkit-text-stroke:1px_color-mix(in_oklab,#c99be6_55%,transparent)]"
        >
          Persuna
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-6 text-sm text-white/45">
          <span>© {new Date().getFullYear()} Persuna · MIT licensed</span>
          <span className="label-mono">AI-produced · owner-approved</span>
        </div>
      </div>
    </footer>
  );
}
