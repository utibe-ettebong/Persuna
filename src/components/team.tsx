import Link from "next/link";
import type { Playbook } from "@/lib/teams/types";
import { Badge } from "./ui";

/** Tabs across an organisation's pages. */
export function TeamTabs({ slug, active }: { slug: string; active: string }) {
  const tabs = [
    { href: `/team?org=${slug}`, label: "Overview" },
    { href: `/team/members?org=${slug}`, label: "People" },
    { href: `/team/handbook?org=${slug}`, label: "Handbook" },
  ];
  return (
    <nav
      className="-mx-4 flex overflow-x-auto overflow-y-hidden border-y border-line sm:-mx-8"
      aria-label="Team"
    >
      {tabs.map((t) => {
        const current = t.label === active;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={current ? "page" : undefined}
            className={`label-mono whitespace-nowrap border-r border-line px-4 py-3 transition-colors ${
              current
                ? "bg-card text-accent shadow-[inset_0_-2px_0_var(--accent)]"
                : "text-muted hover:bg-card hover:text-foreground"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
      <div aria-hidden className="hatch min-w-6 flex-1" />
    </nav>
  );
}

/** A thin progress bar with its count. */
export function Progress({ done, total }: { done: number; total: number }) {
  const percent = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
      >
        <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
      </div>
      <span className="font-mono text-xs text-muted">
        {done}/{total}
      </span>
    </div>
  );
}

export function ConfidentialNote() {
  return (
    <p className="text-xs text-muted">
      <Badge tone="accent">Confidential</Badge> Skills attached to a role are company know-how:
      they&apos;re never listed on the marketplace or shown on public profiles, and only admins and
      people in the same role see their method.
    </p>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <h4 className="label-mono text-faint">{title}</h4>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  );
}

/** A playbook, read-only. */
export function PlaybookView({ playbook }: { playbook: Playbook }) {
  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed">{playbook.summary}</p>
      <div className="grid gap-4 sm:grid-cols-3">
        <List title="Tools" items={playbook.tools} />
        <List title="Quality bar" items={playbook.qualityBar} />
        <List title="Common mistakes" items={playbook.mistakes} />
      </div>
      {playbook.workflows.map((w) => (
        <div key={w.title} className="rounded-md border border-line p-4">
          <h3 className="font-medium">{w.title}</h3>
          {w.when && <p className="text-sm text-muted">When: {w.when}</p>}
          <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-sm">
            {w.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <List title="Tools" items={w.tools} />
            <List title="Quality bar" items={w.qualityBar} />
            <List title="Common mistakes" items={w.mistakes} />
          </div>
        </div>
      ))}
    </div>
  );
}
