import Link from "next/link";
import { EarningsChart } from "@/components/dashboard/earnings-chart";
import { Greeting } from "@/components/dashboard/greeting";
import { PersunaOrb } from "@/components/persuna/orb";
import { ScoreBadge } from "@/components/score-trend";
import { Badge, Card, buttonClass } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { dashboard } from "@/lib/dashboard/service";
import { formatUsd } from "@/lib/money";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

const ROLE = { poster: "Client", seller: "Seller", proposer: "Proposed" } as const;
const ORDER = {
  awaiting_payment: "Awaiting payment",
  review: "With the owner",
  approved: "Delivered",
  rejected: "Declined",
} as const;
const IMPORT = {
  received: "Received",
  training: "Training",
  testing: "Testing",
  verified: "Verified",
  failed: "Didn't pass",
} as const;

function Panel({
  title,
  href,
  action,
  children,
  className = "",
}: {
  title: string;
  href?: string;
  action?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={`flex flex-col rounded-lg p-5 ${className}`}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-lg font-medium tracking-[-0.01em]">{title}</h2>
        {href && (
          <Link href={href} className="label-mono text-muted hover:text-accent">
            {action ?? "See all"} →
          </Link>
        )}
      </div>
      {children}
    </Card>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-faint">{children}</p>;
}

/**
 * Home for a signed-in person: what needs them now, the money (earned, in
 * escrow, per week), their skills and how they score, their projects as
 * client and seller with each one's next step, orders, imports and to-dos.
 */
export default async function DashboardPage() {
  const user = await requireUser();
  const d = await dashboard(user.id);
  const first = user.name.split(/\s+/)[0] || "there";
  const published = d.skills.filter((s) => s.published).length;
  const listed = d.skills.filter((s) => s.listing?.active).length;

  const tiles: [string, string, string, string?][] = [
    ["Earned", formatUsd(d.money.earnedCents), "all time, after fees", "/earnings"],
    ["Last 30 days", formatUsd(d.money.last30Cents), "released to you", "/earnings"],
    ["In escrow", formatUsd(d.money.heldCents), "paid in, held until accepted", "/earnings"],
    [
      "To review",
      String(d.jobsWaiting),
      d.jobsWaiting === 1 ? "result waiting" : "results waiting",
      "/jobs",
    ],
    ["Skills", `${published} / ${d.skills.length}`, `published · ${listed} listed`, "/skills"],
  ];

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-6">
        <div>
          <h1 className="font-display text-2xl font-medium tracking-[-0.02em] sm:text-3xl">
            <Greeting name={first} />
          </h1>
          <p className="mt-1 text-muted">
            {d.attention.length
              ? `${d.attention.length} thing${d.attention.length === 1 ? "" : "s"} need${d.attention.length === 1 ? "s" : ""} you.`
              : "Nothing needs you right now."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/projects/new" className={buttonClass("primary")}>
            Post a project
          </Link>
          <Link href="/skills/new" className={buttonClass("secondary")}>
            New skill
          </Link>
          <Link href="/market" className={buttonClass("secondary")}>
            Marketplace
          </Link>
        </div>
      </header>

      <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {tiles.map(([label, value, hint, href]) => (
          <Link
            key={label}
            href={href ?? "#"}
            className="group rounded-lg border border-line bg-card p-5 shadow-[0_1px_2px_rgba(29,22,29,0.04)] transition-colors hover:border-accent/40"
          >
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="mt-2 font-display text-3xl font-medium tracking-[-0.02em] group-hover:text-accent">
              {value}
            </dd>
            <dd className="mt-1 text-xs text-faint">{hint}</dd>
          </Link>
        ))}
      </dl>

      <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <Panel title="Needs you">
          {d.attention.length === 0 ? (
            <Empty>You&apos;re all caught up.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {d.attention.map((a, i) => (
                <li key={i}>
                  <Link
                    href={a.href}
                    className="flex items-center gap-3 py-2.5 text-sm hover:text-accent"
                  >
                    <span
                      aria-hidden
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        a.tone === "warn"
                          ? "bg-warn"
                          : a.tone === "accent"
                            ? "bg-accent"
                            : "bg-line-strong"
                      }`}
                    />
                    <span className="flex-1">{a.label}</span>
                    <span className="label-mono text-faint">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Card className="flex items-center gap-4 rounded-lg p-5">
          <PersunaOrb look={d.persuna.avatar} size={64} animate={false} />
          <div className="min-w-0 flex-1">
            <p className="label-mono text-faint">Your Persuna</p>
            <p className="font-display text-xl font-medium">{d.persuna.name}</p>
            <p className="truncate text-sm text-muted">
              {d.persuna.focus
                ? `Working on: ${d.persuna.focus}`
                : "Tell it what you're working on today."}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Link href="/persuna" className="label-mono text-accent hover:underline">
                Notes and to-dos →
              </Link>
              <Link href="/download" className="label-mono text-muted hover:text-accent">
                Desktop app →
              </Link>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <Panel title="Earnings" href="/earnings" action="Earnings">
          <EarningsChart
            weeks={d.money.weeks.map((w) => ({ week: w.week.toISOString(), cents: w.cents }))}
          />
        </Panel>

        <Panel title="To-dos" href="/persuna#todos">
          {d.todos.length === 0 ? (
            <Empty>No open to-dos. Ask your Persuna to remind you of anything.</Empty>
          ) : (
            <ul className="space-y-2 text-sm">
              {d.todos.map((t) => (
                <li key={t.id} className="flex items-start gap-2">
                  <span
                    aria-hidden
                    className="mt-1.5 h-3 w-3 shrink-0 rounded-sm border border-line-strong"
                  />
                  <span className="flex-1">{t.text}</span>
                  {t.dueAt && (
                    <span className="label-mono shrink-0 text-faint">
                      {t.dueAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Your skills" href="/skills" action="All skills">
        {d.skills.length === 0 ? (
          <Empty>
            No skills yet.{" "}
            <Link href="/skills/new" className="text-accent underline">
              Teach Persuna your first task
            </Link>
            , or{" "}
            <Link href="/skills/import" className="text-accent underline">
              bring one from another AI agent
            </Link>
            .
          </Empty>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="label-mono text-left text-faint">
                  <th className="px-5 pb-2 font-normal">Skill</th>
                  <th className="pb-2 font-normal">Score</th>
                  <th className="pb-2 font-normal">Marketplace</th>
                  <th className="pb-2 font-normal">To review</th>
                  <th className="px-5 pb-2 text-right font-normal">Price</th>
                </tr>
              </thead>
              <tbody>
                {d.skills.map((s) => (
                  <tr key={s.slug} className="border-t border-line">
                    <td className="px-5 py-2.5">
                      <Link href={`/skills/${s.slug}`} className="font-medium hover:text-accent">
                        {s.name}
                      </Link>
                      {!s.published && (
                        <span className="ml-2 text-xs text-faint">not published</span>
                      )}
                    </td>
                    <td className="py-2.5">
                      <ScoreBadge score={s.score} />
                    </td>
                    <td className="py-2.5">
                      {s.listing?.paused ? (
                        <Badge tone="warn">Paused</Badge>
                      ) : s.listing?.active ? (
                        <Badge tone="good">Listed</Badge>
                      ) : (
                        <Link
                          href={`/skills/${s.slug}/listing`}
                          className="label-mono text-muted hover:text-accent"
                        >
                          List it
                        </Link>
                      )}
                    </td>
                    <td className="py-2.5">{s.waiting || "—"}</td>
                    <td className="px-5 py-2.5 text-right">
                      {s.listing ? formatUsd(s.listing.priceCents) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Projects" href="/projects" action="Projects" className="lg:col-span-2">
          {d.projects.length === 0 ? (
            <Empty>
              No projects yet.{" "}
              <Link href="/projects/new" className="text-accent underline">
                Post one
              </Link>{" "}
              and Persuna turns it into milestones, or{" "}
              <Link href="/projects" className="text-accent underline">
                find work
              </Link>
              .
            </Empty>
          ) : (
            <ul className="divide-y divide-line">
              {d.projects.map((p) => (
                <li key={`${p.id}-${p.role}`}>
                  <Link
                    href={`/projects/${p.id}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm"
                  >
                    <Badge tone={p.role === "poster" ? "accent" : "neutral"}>{ROLE[p.role]}</Badge>
                    <span className="min-w-0 flex-1 truncate font-medium hover:text-accent">
                      {p.title}
                    </span>
                    <span className={p.next.yours ? "text-accent" : "text-muted"}>
                      {p.next.label}
                    </span>
                    <span className="label-mono w-20 text-right text-faint">
                      {formatUsd(p.budgetCents)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="space-y-6">
          <Panel title="Your orders" href="/market" action="Marketplace">
            {d.orders.length === 0 ? (
              <Empty>Skills you rent show here.</Empty>
            ) : (
              <ul className="space-y-2 text-sm">
                {d.orders.map((o) => (
                  <li key={o.id}>
                    <Link
                      href={`/market/orders/${o.id}`}
                      className="flex items-center justify-between gap-2 hover:text-accent"
                    >
                      <span className="truncate">{o.skill}</span>
                      <span className="label-mono shrink-0 text-faint">{ORDER[o.status]}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="From your other agents" href="/skills/import" action="Import">
            {d.imports.length === 0 ? (
              <Empty>
                Connect Grokbot, Musebot or another agent to bring the skills it has learned.
              </Empty>
            ) : (
              <ul className="space-y-2 text-sm">
                {d.imports.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">{i.agentName}</span>
                    <Badge
                      tone={
                        i.status === "verified"
                          ? "good"
                          : i.status === "failed"
                            ? "warn"
                            : "neutral"
                      }
                    >
                      {IMPORT[i.status]}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
