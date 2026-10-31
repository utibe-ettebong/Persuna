import type { Metadata } from "next";
import {
  addCatalogEntryAction,
  deleteCatalogEntryAction,
  revertRoleAction,
  selectModelAction,
  setCatalogEnabledAction,
} from "@/app/actions/admin";
import { ActionForm } from "@/components/action-form";
import { ProbeForm } from "@/components/admin/probe-form";
import { Badge, Card, inputClass, PageHeader } from "@/components/ui";
import { modelConfig, modelProvider, speechConfig, transcriptionConfig } from "@/env";
import type { ModelRole } from "@/env";
import { outageStatus } from "@/lib/models/gateway";
import {
  catalogRoles,
  listCatalog,
  providerPresets,
  type CatalogEntry,
  type CatalogRole,
} from "@/lib/models/selection";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin · Models" };

const ROLES: { id: CatalogRole; name: string; use: string }[] = [
  { id: "extract", name: "Learn", use: "Extracts rules and turns corrections into rule changes." },
  { id: "draft", name: "Draft", use: "Drafts test runs and real jobs." },
  { id: "evaluate", name: "Score", use: "Scores drafts and runs the self-check." },
  { id: "listen", name: "Listen", use: "Hears speech and answers with no transcription first." },
  { id: "transcribe", name: "Transcribe", use: "Voice walkthroughs and voice-note jobs." },
  { id: "speech", name: "Voice", use: "Persuna's spoken replies." },
];

/** The env model id per role, or null when the role has no settings. */
function envModel(role: CatalogRole): string | null {
  try {
    if (role === "transcribe") return transcriptionConfig().model;
    if (role === "speech") return speechConfig()?.model ?? null;
    return modelConfig(role as ModelRole).model;
  } catch {
    return null;
  }
}

/** Which providers are being skipped right now (outages and rejected keys). */
function OutageLine() {
  const skipped = outageStatus();
  if (skipped.length === 0) {
    return (
      <Card className="p-5">
        <p className="text-sm text-muted">
          <Badge tone="good">All providers answering</Badge> No outage or rejected-key cooldowns are
          skipping anyone.
        </p>
      </Card>
    );
  }
  return (
    <Card className="border-warn/50 p-5">
      <p className="text-sm">
        <Badge tone="warn">Skipping {skipped.length}</Badge>{" "}
        <span className="text-muted">
          {skipped
            .map(
              (entry) =>
                `${entry.target} (${entry.kind === "outage" ? "outage" : "key rejected"}, retry in ${entry.retryInSec}s)`,
            )
            .join(" · ")}
        </span>
      </p>
    </Card>
  );
}

const EFFORTS = ["none", "minimal", "low", "medium", "high", "max"] as const;
const REASONED: CatalogRole[] = ["extract", "draft", "evaluate", "listen"];

/** Which model serves each role, selectable from the catalog. Admins only. */
export default async function AdminModelsPage() {
  const entries = await listCatalog();
  const byRole = new Map<CatalogRole, CatalogEntry[]>();
  for (const role of catalogRoles)
    byRole.set(
      role,
      entries.filter((e) => e.role === role),
    );
  const mock = modelProvider() === "mock";
  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/admin", label: "Admin" }}
        title="Models"
        description="Which provider and model id serves each role. Selections override env and take effect at once; reverting returns to env. Providers are the key slots set in Railway; keys are never shown or stored here."
      />
      {mock && (
        <Card className="border-warn/50 p-5">
          <p className="text-sm text-muted">
            <Badge tone="warn">Mock models</Badge> This app runs mocks, so selections change nothing
            until live keys are set. Models & keys shows the key slots.
          </p>
        </Card>
      )}
      <OutageLine />
      {ROLES.map(({ id, name, use }) => {
        const roleEntries = byRole.get(id) ?? [];
        const selected = roleEntries.find((e) => e.selected && e.enabled);
        const fallback = envModel(id);
        const presets = providerPresets(id);
        const presetLabel = (provider: string | null) =>
          provider ? (presets.find((preset) => preset.id === provider)?.label ?? provider) : null;
        return (
          <Card key={id} className="space-y-4 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 className="font-display text-xl font-medium tracking-[-0.02em]">{name}</h2>
                <p className="mt-1 text-sm text-muted">{use}</p>
              </div>
              <p className="text-sm">
                {selected ? (
                  <>
                    <span className="font-mono text-xs">{selected.model}</span>{" "}
                    <Badge tone="accent">Catalog: {selected.label}</Badge>
                  </>
                ) : fallback ? (
                  <>
                    <span className="font-mono text-xs">{fallback}</span> <Badge>Env</Badge>
                  </>
                ) : (
                  <Badge tone="warn">Not configured</Badge>
                )}
              </p>
            </div>
            {selected && (
              <ActionForm
                action={revertRoleAction}
                pendingLabel="Reverting…"
                buttons={[{ label: "Revert to env", variant: "secondary" }]}
              >
                <input type="hidden" name="role" value={id} />
              </ActionForm>
            )}
            {roleEntries.length > 0 && (
              <ul className="divide-y divide-line rounded-md border border-line">
                {roleEntries.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3 text-sm"
                  >
                    <span className="font-medium">{entry.label}</span>
                    <span className="break-all font-mono text-xs text-muted">{entry.model}</span>
                    {presetLabel(entry.provider) && (
                      <span className="text-xs text-muted">{presetLabel(entry.provider)}</span>
                    )}
                    {entry.voice && <span className="text-xs text-muted">voice {entry.voice}</span>}
                    {entry.reasoningEffort && (
                      <span className="text-xs text-muted">{entry.reasoningEffort} thinking</span>
                    )}
                    {entry.selected && entry.enabled ? (
                      <Badge tone="accent">Selected</Badge>
                    ) : entry.enabled ? null : (
                      <Badge tone="warn">Disabled</Badge>
                    )}
                    <span className="ml-auto flex flex-wrap items-center gap-2">
                      <ProbeForm role={id} model={entry.model} />
                      {entry.enabled && !(entry.selected && entry.enabled) && (
                        <ActionForm
                          action={selectModelAction}
                          pendingLabel="Saving…"
                          buttons={[{ label: "Use", variant: "primary" }]}
                        >
                          <input type="hidden" name="role" value={id} />
                          <input type="hidden" name="entryId" value={entry.id} />
                        </ActionForm>
                      )}
                      <ActionForm
                        action={setCatalogEnabledAction}
                        pendingLabel="Saving…"
                        buttons={[
                          {
                            label: entry.enabled ? "Disable" : "Enable",
                            intent: entry.enabled ? "disable" : "enable",
                            variant: "secondary",
                          },
                        ]}
                      >
                        <input type="hidden" name="entryId" value={entry.id} />
                      </ActionForm>
                      <ActionForm
                        action={deleteCatalogEntryAction}
                        pendingLabel="Deleting…"
                        buttons={[{ label: "Delete", variant: "danger" }]}
                      >
                        <input type="hidden" name="entryId" value={entry.id} />
                      </ActionForm>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <ActionForm
              action={addCatalogEntryAction}
              pendingLabel="Saving…"
              buttons={[{ label: "Catalog model", variant: "secondary" }]}
            >
              <input type="hidden" name="role" value={id} />
              <div className="mb-2 grid gap-2 sm:grid-cols-2">
                <input
                  name="label"
                  placeholder="Label, e.g. Spark 1.3 (current)"
                  required
                  minLength={2}
                  maxLength={60}
                  className={inputClass}
                  aria-label={`Label for a new ${name} model`}
                />
                <input
                  name="model"
                  placeholder="Provider model id"
                  required
                  maxLength={120}
                  className={inputClass}
                  aria-label={`Model id for a new ${name} model`}
                />
                {presets.length > 0 && (
                  <select
                    name="provider"
                    defaultValue=""
                    className={inputClass}
                    aria-label={`Provider for a new ${name} model`}
                  >
                    <option value="">Provider: env default</option>
                    {presets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                        {preset.baseUrl ? ` (${preset.baseUrl})` : ""}
                      </option>
                    ))}
                  </select>
                )}
                <input
                  name="baseUrl"
                  placeholder="Base URL override (optional)"
                  maxLength={300}
                  className={inputClass}
                  aria-label={`Base URL override for a new ${name} model`}
                />
                {id === "speech" && (
                  <input
                    name="voice"
                    placeholder="Voice id (optional)"
                    maxLength={120}
                    className={inputClass}
                    aria-label="Voice id for a new voice model"
                  />
                )}
                {REASONED.includes(id) && (
                  <select
                    name="reasoningEffort"
                    defaultValue=""
                    className={inputClass}
                    aria-label={`Reasoning level for a new ${name} model`}
                  >
                    <option value="">Thinking: env default</option>
                    {EFFORTS.map((effort) => (
                      <option key={effort} value={effort}>
                        {effort}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </ActionForm>
            <p className="text-xs text-faint">
              Saving probes the id against this role{"'"}s live settings; a failed probe saves
              nothing. Check Models & keys for the key slot a new id needs.
            </p>
          </Card>
        );
      })}
      <p className="text-xs text-faint">
        Provider keys live in Railway variables; this page never shows or stores them.
      </p>
    </div>
  );
}
