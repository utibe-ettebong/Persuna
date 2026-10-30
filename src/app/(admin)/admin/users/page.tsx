import type { Metadata } from "next";
import Link from "next/link";
import { Badge, buttonClass, Card, inputClass, PageHeader } from "@/components/ui";
import { matchesList, parseList } from "@/lib/auth/policy";
import { listUsers, parseUserListQuery, USER_PAGE_SIZE } from "@/lib/auth/users";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin · Users" };

type Search = { searchParams: Promise<{ q?: string; page?: string }> };

const joined = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });

/** Every account, newest first, searchable. Admins only (see the layout). */
export default async function AdminUsersPage({ searchParams }: Search) {
  const params = await searchParams;
  const query = parseUserListQuery(params);
  const { rows, total } = await listUsers(query);
  const pages = Math.max(1, Math.ceil(total / USER_PAGE_SIZE));
  const pageHref = (page: number) => {
    const sp = new URLSearchParams();
    if (query.search) sp.set("q", query.search);
    if (page > 1) sp.set("page", String(page));
    const qs = sp.toString();
    return qs ? `/admin/users?${qs}` : "/admin/users";
  };
  const admins = parseList(process.env.ADMIN_EMAILS);
  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/admin", label: "Admin" }}
        title="Users"
        description={`${total.toLocaleString()} accounts. Suspended accounts read as signed out everywhere.`}
      />
      <form method="get" action="/admin/users" className="flex gap-2">
        <div className="flex-1">
          <input
            name="q"
            defaultValue={query.search ?? ""}
            placeholder="Search name or email"
            maxLength={120}
            className={inputClass}
            aria-label="Search name or email"
          />
        </div>
        <button type="submit" className={`${buttonClass("secondary")} mt-1.5 self-start`}>
          Search
        </button>
      </form>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No accounts match.</p>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="label-mono border-b border-line text-muted">
              <tr>
                <th className="p-3 font-semibold">Name</th>
                <th className="p-3 font-semibold">Email</th>
                <th className="p-3 font-semibold">Status</th>
                <th className="p-3 font-semibold">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((u) => (
                <tr key={u.id} className="align-top transition-colors hover:bg-subtle">
                  <td className="p-3">
                    <Link
                      href={`/admin/users/${encodeURIComponent(u.id)}`}
                      className="font-medium hover:text-accent hover:underline"
                    >
                      {u.name}
                    </Link>
                  </td>
                  <td className="break-all p-3 font-mono text-xs text-muted">{u.email}</td>
                  <td className="whitespace-nowrap p-3">
                    {u.suspended ? (
                      <Badge tone="danger">Suspended</Badge>
                    ) : matchesList(u.email, admins) ? (
                      <Badge tone="accent">Admin</Badge>
                    ) : (
                      <Badge tone="good">Active</Badge>
                    )}
                  </td>
                  <td className="whitespace-nowrap p-3 tabular-nums text-muted">
                    {joined.format(u.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {pages > 1 && (
        <p className="flex items-center gap-3 text-sm text-muted">
          <span>
            Page {query.page} of {pages}
          </span>
          {query.page > 1 && (
            <Link href={pageHref(query.page - 1)} className="text-accent hover:underline">
              ← Newer
            </Link>
          )}
          {query.page < pages && (
            <Link href={pageHref(query.page + 1)} className="text-accent hover:underline">
              Older →
            </Link>
          )}
        </p>
      )}
    </div>
  );
}
