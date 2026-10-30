import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { startOfUtcDay } from "@/lib/admin/stats";
import { dailyUsage, topUsersByUsage, usageByRole } from "@/lib/admin/usage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin · Model usage" };

/** Who spends model calls, on what, and when. Admins only. */
export default async function AdminUsagePage() {
  const [byRole, today, top, daily] = await Promise.all([
    usageByRole(),
    usageByRole(startOfUtcDay()),
    topUsersByUsage(20),
    dailyUsage(14),
  ]);
  const todayByRole = new Map(today.map((r) => [r.role, r.calls]));
  const peak = Math.max(1, ...daily.map((d) => d.calls));
  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/admin", label: "Admin" }}
        title="Model usage"
        description="Model calls by role, heaviest users, and the last fortnight. Counts calls, not tokens."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-2 p-5">
          <p className="label-mono text-muted">Calls by role</p>
          {byRole.length === 0 ? (
            <p className="text-sm text-muted">No calls recorded yet.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="label-mono border-b border-line text-muted">
                <tr>
                  <th className="py-2 pr-3 font-semibold">Role</th>
                  <th className="py-2 pr-3 text-right font-semibold">Today</th>
                  <th className="py-2 text-right font-semibold">All time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {byRole.map((r) => (
                  <tr key={r.role}>
                    <td className="py-2 pr-3 font-mono text-xs">{r.role}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {(todayByRole.get(r.role) ?? 0).toLocaleString()}
                    </td>
                    <td className="py-2 text-right tabular-nums">{r.calls.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card className="space-y-2 p-5">
          <p className="label-mono text-muted">Heaviest users</p>
          {top.length === 0 ? (
            <p className="text-sm text-muted">No calls recorded yet.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="label-mono border-b border-line text-muted">
                <tr>
                  <th className="py-2 pr-3 font-semibold">Account</th>
                  <th className="py-2 text-right font-semibold">Calls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {top.map((u) => (
                  <tr key={u.userId}>
                    <td className="py-2 pr-3">
                      <Link
                        href={`/admin/users/${encodeURIComponent(u.userId)}`}
                        className="font-medium hover:text-accent hover:underline"
                      >
                        {u.name}
                      </Link>{" "}
                      <span className="break-all font-mono text-xs text-muted">{u.email}</span>
                    </td>
                    <td className="py-2 text-right tabular-nums">{u.calls.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
      <Card className="space-y-2 p-5">
        <p className="label-mono text-muted">Calls per day</p>
        <ol className="space-y-1.5">
          {daily.map((d) => (
            <li key={d.day} className="flex items-center gap-3 text-sm">
              <span className="w-24 shrink-0 font-mono text-xs text-muted tabular-nums">
                {d.day}
              </span>
              <span
                className="h-3 rounded-sm bg-accent/70"
                style={{ width: `${Math.max(d.calls > 0 ? 2 : 0, (d.calls / peak) * 100)}%` }}
                aria-hidden
              />
              <span className="shrink-0 tabular-nums text-muted">{d.calls.toLocaleString()}</span>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
