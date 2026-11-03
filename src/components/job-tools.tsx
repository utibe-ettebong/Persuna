import {
  decideJobApprovalAction,
  linkJobConnectionAction,
  setJobToolPolicyAction,
  startJobAction,
  unlinkJobConnectionAction,
} from "@/app/actions/jobs";
import { ActionForm } from "@/components/action-form";
import { Card, Field, inputClass } from "@/components/ui";
import type { JobApproval, JobConnection, JobToolPolicy } from "@/db/schema";
import type { listConnections } from "@/lib/connections/service";
import type { McpServerView } from "@/lib/mcp/service";

type Page = "job" | "order";

interface Setup {
  started: boolean;
  declaredTools: string[];
  policy: JobToolPolicy | null;
  links: JobConnection[];
}

/**
 * The requester's setup for a tool job: link their own apps, pick the
 * approval policy, and start. Only rendered for the requester, before the
 * job starts.
 */
export function JobToolSetup({
  jobId,
  page,
  setup,
  apps,
  servers,
}: {
  jobId: string;
  page: Page;
  setup: Setup;
  apps: Awaited<ReturnType<typeof listConnections>>;
  servers: McpServerView[];
}) {
  const connectableApps = apps.filter((a) => a.account);
  const unlinkedApps = connectableApps.filter(
    (a) => !setup.links.some((l) => l.kind === "app" && l.ref === a.provider),
  );
  const unlinkedServers = servers.filter(
    (s) => !setup.links.some((l) => l.kind === "mcp" && l.ref === s.id),
  );
  return (
    <Card className="p-5">
      <h2 className="font-display text-lg font-medium tracking-[-0.02em]">
        Your apps for this job
      </h2>
      <p className="mt-1 text-sm text-muted">
        This skill works inside your apps, through your own connections. Link what it may use — the
        skill owner never sees them — then start.
        {setup.declaredTools.length > 0 && <> It uses: {setup.declaredTools.join(", ")}.</>}
      </p>

      {setup.links.length > 0 && (
        <ul className="mt-3 divide-y divide-line text-sm">
          {setup.links.map((link) => (
            <li key={link.id} className="flex items-center gap-3 py-2">
              <span className="flex-1">
                {link.kind === "app"
                  ? (apps.find((a) => a.provider === link.ref)?.name ?? link.ref)
                  : (servers.find((s) => s.id === link.ref)?.name ?? "MCP server")}
              </span>
              <ActionForm
                action={unlinkJobConnectionAction}
                label="Unlink"
                pendingLabel="…"
                variant="danger"
              >
                <input type="hidden" name="jobId" value={jobId} />
                <input type="hidden" name="page" value={page} />
                <input type="hidden" name="kind" value={link.kind} />
                <input type="hidden" name="ref" value={link.ref} />
              </ActionForm>
            </li>
          ))}
        </ul>
      )}

      {(unlinkedApps.length > 0 || unlinkedServers.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {unlinkedApps.length > 0 && (
            <ActionForm
              action={linkJobConnectionAction}
              label="Link app"
              pendingLabel="Linking…"
              className="flex flex-wrap items-center gap-2"
            >
              <input type="hidden" name="jobId" value={jobId} />
              <input type="hidden" name="page" value={page} />
              <input type="hidden" name="kind" value="app" />
              <select name="ref" className={inputClass} aria-label="App to link" required>
                {unlinkedApps.map((a) => (
                  <option key={a.provider} value={a.provider}>
                    {a.name} ({a.account})
                  </option>
                ))}
              </select>
            </ActionForm>
          )}
          {unlinkedServers.length > 0 && (
            <ActionForm
              action={linkJobConnectionAction}
              label="Link MCP server"
              pendingLabel="Linking…"
              className="flex flex-wrap items-center gap-2"
            >
              <input type="hidden" name="jobId" value={jobId} />
              <input type="hidden" name="page" value={page} />
              <input type="hidden" name="kind" value="mcp" />
              <select name="ref" className={inputClass} aria-label="MCP server to link" required>
                {unlinkedServers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </ActionForm>
          )}
        </div>
      )}
      {connectableApps.length === 0 && servers.length === 0 && (
        <p className="mt-3 text-sm text-muted">
          Connect an app or MCP server on the Persuna page first.
        </p>
      )}

      <ActionForm
        action={setJobToolPolicyAction}
        label="Save policy"
        pendingLabel="Saving…"
        className="mt-4 space-y-3"
      >
        <input type="hidden" name="jobId" value={jobId} />
        <input type="hidden" name="page" value={page} />
        <Field label="Writes ask for approval">
          <select
            name="mode"
            defaultValue={setup.policy?.mode ?? "approve_each"}
            className={inputClass}
          >
            <option value="approve_each">Ask me for each write</option>
            <option value="preapproved">Pre-approve these tools</option>
          </select>
        </Field>
        <Field label="Pre-approved tools" hint="comma-separated names, used only with pre-approve">
          <input
            name="tools"
            defaultValue={(setup.policy?.tools ?? []).join(", ")}
            placeholder="notion_create_page"
            className={inputClass}
          />
        </Field>
      </ActionForm>

      {!setup.started && (
        <ActionForm
          action={startJobAction}
          label={setup.links.length ? "Start the job" : "Link an app to start"}
          pendingLabel="Working…"
          className="mt-4"
        >
          <input type="hidden" name="jobId" value={jobId} />
          <input type="hidden" name="page" value={page} />
        </ActionForm>
      )}
    </Card>
  );
}

/** Writes waiting for the requester's decision. Requester only. */
export function JobApprovals({
  jobId,
  page,
  approvals,
}: {
  jobId: string;
  page: Page;
  approvals: JobApproval[];
}) {
  const pending = approvals.filter((a) => a.status === "pending");
  if (!pending.length) return null;
  return (
    <Card className="p-5">
      <h2 className="font-display text-lg font-medium tracking-[-0.02em]">
        Approve what the skill does
      </h2>
      <p className="mt-1 text-sm text-muted">
        The job paused for your decision. Nothing runs until you approve it.
      </p>
      <ul className="mt-3 space-y-3">
        {pending.map((approval) => (
          <li key={approval.id} className="rounded-md bg-subtle p-3 text-sm">
            <p className="whitespace-pre-wrap">{approval.preview}</p>
            <ActionForm
              action={decideJobApprovalAction}
              pendingLabel="Saving…"
              className="mt-2"
              buttons={[
                { label: "Approve", intent: "approve" },
                { label: "Deny", intent: "deny", variant: "danger" },
              ]}
            >
              <input type="hidden" name="jobId" value={jobId} />
              <input type="hidden" name="page" value={page} />
              <input type="hidden" name="approvalId" value={approval.id} />
            </ActionForm>
          </li>
        ))}
      </ul>
    </Card>
  );
}
