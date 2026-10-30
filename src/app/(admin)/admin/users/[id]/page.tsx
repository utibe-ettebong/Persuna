import type { Metadata } from "next";
import { setSuspendedAction } from "@/app/actions/admin";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/session";
import { userOverview } from "@/lib/auth/users";
import { orNotFound } from "@/lib/load";
import { NotFoundError } from "@/lib/skill/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin · User" };

type Params = { params: Promise<{ id: string }> };

const joined = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });

/** One account: what they own and have used, plus suspension. Admins only. */
export default async function AdminUserPage({ params }: Params) {
  const { id } = await params;
  const admin = await requireAdmin();
  const overview = await orNotFound(async () => {
    const found = await userOverview(decodeURIComponent(id));
    if (!found) throw new NotFoundError("No such user");
    return found;
  });
  const { record, counts } = overview;
  const self = record.id === admin.id;
  const figures: [string, number][] = [
    ["Skills owned", counts.skills],
    ["Jobs ordered", counts.jobsOrdered],
    ["Projects posted", counts.projectsPosted],
    ["Model calls", counts.modelCalls],
  ];
  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/admin/users", label: "Users" }}
        title={record.name}
        description={
          <>
            <span className="font-mono text-xs">{record.email}</span>
            <span className="text-faint">
              {" "}
              · joined {joined.format(record.createdAt)}
              {record.emailVerified ? "" : " · email unverified"}
            </span>
          </>
        }
      >
        {record.suspended ? (
          <Badge tone="danger">Suspended</Badge>
        ) : (
          <Badge tone="good">Active</Badge>
        )}
        {self && <Badge>Your account</Badge>}
      </PageHeader>
      <div className="grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        {figures.map(([label, value]) => (
          <div key={label} className="bg-card p-6">
            <p className="font-display text-3xl font-medium tracking-[-0.02em] tabular-nums">
              {value.toLocaleString()}
            </p>
            <p className="label-mono mt-2 text-muted">{label}</p>
          </div>
        ))}
      </div>
      <Card className="space-y-3 p-5">
        <p className="label-mono text-muted">Access</p>
        {self ? (
          <p className="text-sm text-muted">
            This is your own account; it cannot be suspended from here.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted">
              {record.suspended
                ? "Suspended: this account reads as signed out everywhere. Lifting restores access at once."
                : "Suspension signs this account out everywhere at once: web, voice and agent imports. Nothing is deleted."}
            </p>
            <ActionForm
              action={setSuspendedAction}
              pendingLabel="Saving…"
              buttons={[
                {
                  label: record.suspended ? "Lift suspension" : "Suspend account",
                  intent: record.suspended ? "unsuspend" : "suspend",
                  variant: record.suspended ? "secondary" : "danger",
                },
              ]}
            >
              <input type="hidden" name="userId" value={record.id} />
            </ActionForm>
          </>
        )}
      </Card>
    </div>
  );
}
