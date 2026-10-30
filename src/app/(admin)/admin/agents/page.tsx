import type { Metadata } from "next";
import { retryAnyImportAction, revokeAnyAgentKeyAction } from "@/app/actions/admin";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, PageHeader, type Tone } from "@/components/ui";
import { agentKeyStatus, type AgentKeyStatus } from "@/lib/admin/rules";
import { listAllAgentKeys, listAllImports } from "@/lib/agents/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin · Agents" };

const KEY_TONE: Record<AgentKeyStatus, Tone> = {
  active: "good",
  unused: "neutral",
  revoked: "danger",
};

const IMPORT_TONE: Record<string, Tone> = {
  received: "neutral",
  training: "accent",
  testing: "accent",
  verified: "good",
  failed: "danger",
};

const when = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

/** Every connected agent key and import, platform-wide. Admins only. */
export default async function AdminAgentsPage() {
  const [keys, imports] = await Promise.all([listAllAgentKeys(), listAllImports()]);
  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/admin", label: "Admin" }}
        title="Agents"
        description={`${keys.length.toLocaleString()} keys, ${imports.length.toLocaleString()} imports. Revoking a key cuts that agent off at once; retried imports reprocess from the saved skill. Submission payloads are never shown.`}
      />
      <section className="space-y-3">
        <h2 className="font-display text-xl font-medium tracking-[-0.02em]">Keys</h2>
        {keys.length === 0 ? (
          <p className="text-sm text-muted">No agent keys.</p>
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="label-mono border-b border-line text-muted">
                <tr>
                  <th className="p-3 font-semibold">Agent</th>
                  <th className="p-3 font-semibold">Owner</th>
                  <th className="p-3 font-semibold">Last used</th>
                  <th className="p-3 font-semibold">Status</th>
                  <th className="p-3 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {keys.map(({ key, ownerEmail }) => {
                  const status = agentKeyStatus(key);
                  return (
                    <tr key={key.id} className="align-top">
                      <td className="p-3">
                        <p className="font-medium">{key.agentName}</p>
                        <p className="font-mono text-xs text-muted">…{key.tokenHint}</p>
                      </td>
                      <td className="break-all p-3 font-mono text-xs text-muted">
                        {ownerEmail ?? "—"}
                      </td>
                      <td className="whitespace-nowrap p-3 tabular-nums text-muted">
                        {key.lastUsedAt ? when.format(key.lastUsedAt) : "Never"}
                      </td>
                      <td className="whitespace-nowrap p-3">
                        <Badge tone={KEY_TONE[status]}>{status}</Badge>
                      </td>
                      <td className="p-3">
                        {status === "revoked" ? (
                          <span className="text-xs text-faint">Revoked</span>
                        ) : (
                          <ActionForm
                            action={revokeAnyAgentKeyAction}
                            pendingLabel="Revoking…"
                            buttons={[{ label: "Revoke", variant: "danger" }]}
                          >
                            <input type="hidden" name="keyId" value={key.id} />
                          </ActionForm>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
      </section>
      <section className="space-y-3">
        <h2 className="font-display text-xl font-medium tracking-[-0.02em]">Imports</h2>
        {imports.length === 0 ? (
          <p className="text-sm text-muted">No imports.</p>
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="label-mono border-b border-line text-muted">
                <tr>
                  <th className="p-3 font-semibold">Agent</th>
                  <th className="p-3 font-semibold">Owner</th>
                  <th className="p-3 font-semibold">Status</th>
                  <th className="p-3 font-semibold">Report</th>
                  <th className="p-3 font-semibold">Updated</th>
                  <th className="p-3 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {imports.map((row) => (
                  <tr key={row.id} className="align-top">
                    <td className="p-3">
                      <p className="font-medium">{row.agentName}</p>
                      <p className="font-mono text-xs text-muted">{row.keyName ?? "upload"}</p>
                    </td>
                    <td className="break-all p-3 font-mono text-xs text-muted">
                      {row.ownerEmail ?? "—"}
                    </td>
                    <td className="whitespace-nowrap p-3">
                      <Badge tone={IMPORT_TONE[row.status] ?? "neutral"}>{row.status}</Badge>
                    </td>
                    <td className="max-w-64 p-3 text-xs text-muted">
                      {(row.error ??
                        [
                          row.report.outcome,
                          row.report.score != null ? `score ${row.report.score}` : "",
                          row.report.rules != null ? `${row.report.rules} rules` : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")) ||
                        "—"}
                    </td>
                    <td className="whitespace-nowrap p-3 tabular-nums text-muted">
                      {when.format(row.updatedAt)}
                    </td>
                    <td className="p-3">
                      {row.status === "failed" ? (
                        <ActionForm
                          action={retryAnyImportAction}
                          pendingLabel="Retrying…"
                          buttons={[{ label: "Retry", variant: "secondary" }]}
                        >
                          <input type="hidden" name="importId" value={row.id} />
                        </ActionForm>
                      ) : (
                        <span className="text-xs text-faint">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>
    </div>
  );
}
