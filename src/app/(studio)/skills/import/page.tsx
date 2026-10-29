import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import {
  publishImportAction,
  retryImportAction,
  revokeAgentKeyAction,
  uploadImportAction,
} from "@/app/actions/agents";
import { ActionForm } from "@/components/action-form";
import { AgentKeyForm } from "@/components/agent-key-form";
import { Badge, Card, Field, inputClass, PageHeader, type Tone } from "@/components/ui";
import { env } from "@/env";
import {
  IMPORTS_PER_HOUR,
  MAX_EXAMPLES,
  MIN_EXAMPLES,
  SKILL_IMPORT_SCHEMA,
} from "@/lib/agents/rules";
import { listAgentKeys, listImports, processImport, staleImportIds } from "@/lib/agents/service";
import { requireUser } from "@/lib/auth/session";
import { plural } from "@/lib/plural";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Bring your agent's skills" };

const STATUS: Record<string, { tone: Tone; label: string }> = {
  received: { tone: "neutral", label: "received" },
  training: { tone: "accent", label: "training" },
  testing: { tone: "accent", label: "testing" },
  verified: { tone: "good", label: "verified" },
  failed: { tone: "danger", label: "failed" },
};

const date = (d: Date | null) =>
  d ? d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "never";

export default async function ImportPage() {
  const user = await requireUser("/skills/import");
  const [keys, imports, stale] = await Promise.all([
    listAgentKeys(user.id),
    listImports(user.id),
    staleImportIds(user.id),
  ]);
  // Anything interrupted mid-run (e.g. by a restart) carries on after this page is sent.
  if (stale.length) {
    after(async () => {
      for (const id of stale) await processImport(id).catch((e) => console.error(e));
    });
  }
  const base = env().APP_URL?.replace(/\/+$/, "") ?? "https://your-persuna-address";
  const minScore = env().LISTING_MIN_SCORE;
  /** The deployed MCP Worker (Persuna as an MCP server), when configured. */
  const mcpUrl = env().MCP_SERVER_URL?.replace(/\/+$/, "") ?? null;
  const example = JSON.stringify(
    {
      schema: SKILL_IMPORT_SCHEMA,
      agent: "Grokbot",
      skill: {
        name: "Board meeting minutes",
        task: "Turn raw board meeting notes into finished minutes",
        input: "meeting notes",
        output: "minutes",
      },
      method: [
        "Read the notes once before writing",
        "Header block: date, chair, present, apologies",
        "Each decision on its own line, in bold",
        "Actions in a table: Owner | Action | Due",
      ],
      examples: [
        { input: "raw notes…", output: "finished minutes…" },
        { input: "raw notes…", output: "finished minutes…" },
        { input: "raw notes…", output: "finished minutes…", test: true },
      ],
    },
    null,
    2,
  );
  const curl = `curl -X POST ${base}/api/agents/skills \\
  -H "Authorization: Bearer $PERSUNA_AGENT_KEY" \\
  -H "Content-Type: application/json" \\
  --data @skill.json

# then poll the statusUrl it returns:
curl ${base}/api/agents/skills/<id> -H "Authorization: Bearer $PERSUNA_AGENT_KEY"`;

  return (
    <div className="space-y-8">
      <PageHeader
        back={{ href: "/skills", label: "Skills" }}
        title="Bring your agent's skills"
        description={`Other AI agents you use (Grokbot, Musebot, Dot…) can send Persuna what they've learned about how you work. Persuna removes names and identifiers, keeps only the method, trains a skill from the examples, tests it on ones it held back, and tells you the score. At ${minScore} or more it's verified and ready to list.`}
      />

      <section className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-4 p-5">
          <h2 className="font-display text-lg font-medium tracking-[-0.02em]">Agent keys</h2>
          <p className="text-sm text-muted">
            Give each agent its own key. It can only send skills to your account and read the status
            of what it sent. Revoke a key at any time.
          </p>
          <AgentKeyForm />
          {keys.length > 0 && (
            <ul className="divide-y divide-line border-t border-line text-sm">
              {keys.map((k) => (
                <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <span>
                    <span className="font-medium">{k.agentName}</span>{" "}
                    <span className="font-mono text-xs text-faint">psk_…{k.tokenHint}</span>
                    <span className="block text-xs text-muted">
                      created {date(k.createdAt)} · last used {date(k.lastUsedAt)}
                    </span>
                  </span>
                  {k.revokedAt ? (
                    <Badge>revoked</Badge>
                  ) : (
                    <ActionForm
                      action={revokeAgentKeyAction}
                      label="Revoke"
                      pendingLabel="Revoking…"
                      variant="danger"
                    >
                      <input type="hidden" name="keyId" value={k.id} />
                    </ActionForm>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="font-display text-lg font-medium tracking-[-0.02em]">Or upload a file</h2>
          <p className="text-sm text-muted">
            If your agent can export what it learned, upload the JSON here. Same format as the API.
          </p>
          <ActionForm
            action={uploadImportAction}
            label="Upload and train"
            pendingLabel="Uploading…"
            className="space-y-3"
          >
            <Field label="Skill file" hint=".json, up to 1 MB">
              <input type="file" name="file" accept="application/json,.json" required />
            </Field>
          </ActionForm>
        </Card>
      </section>

      <Card className="space-y-3 p-5">
        <h2 className="font-display text-lg font-medium tracking-[-0.02em]">For agent builders</h2>
        <p className="text-sm text-muted">
          <code>POST /api/agents/skills</code> with the key as a bearer token and a JSON body in the{" "}
          <code>{SKILL_IMPORT_SCHEMA}</code> format. {MIN_EXAMPLES} to {MAX_EXAMPLES} before/after
          examples; mark held-back ones with <code>&quot;test&quot;: true</code>, or Persuna holds
          back about a quarter. <code>method</code> is a string or a list of steps. It answers{" "}
          <code>202</code> with an id at once; poll <code>GET /api/agents/skills/&lt;id&gt;</code>{" "}
          for <code>received</code> → <code>training</code> → <code>testing</code> →{" "}
          <code>verified</code> or <code>failed</code>, with a report (counts, score, problems). Up
          to {IMPORTS_PER_HOUR} imports an hour per key.
        </p>
        <p className="text-sm text-muted">
          The same key can also <em>run</em> your published skills:{" "}
          <code>GET /api/agents/skills</code> lists them, <code>POST /api/agents/run</code> with{" "}
          <code>{`{ "skill": "<slug>", "input": "…" }`}</code> runs one, and{" "}
          <code>GET /api/agents/runs/&lt;jobId&gt;</code> polls it. Output is returned only when
          your trust level approves the run; until then it waits under Jobs like any other run.
          Prefer MCP? Each published skill also becomes a tool on the Persuna MCP server — see{" "}
          <em>Run your skills from other AI apps (MCP)</em> below for per-platform setup.
        </p>
        <pre className="overflow-x-auto rounded-md bg-subtle p-3 text-xs">{curl}</pre>
        <details>
          <summary className="cursor-pointer text-sm font-medium">skill.json</summary>
          <pre className="mt-2 overflow-x-auto rounded-md bg-subtle p-3 text-xs">{example}</pre>
        </details>
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="font-display text-lg font-medium tracking-[-0.02em]">
          Run your skills from other AI apps (MCP)
        </h2>
        {mcpUrl ? (
          <>
            <p className="text-sm text-muted">
              Your Persuna MCP server is at <code>{mcpUrl}</code>. Each published skill becomes a
              tool there; the code-mode <code>execute</code> tool can chain several in one call
              (needs the <code>CODE_LOADER</code> sandbox binding on the Worker). Use one of your
              agent keys above as the Bearer [REDACTED] wherever a platform asks for it — replace{" "}
              <code>psk_…</code> below with your key.
            </p>
            <div className="space-y-4 text-sm">
              <div>
                <p className="mb-1 font-medium">Claude Code</p>
                <pre className="overflow-x-auto rounded-md bg-subtle p-3 text-xs">{`claude mcp add persuna --transport http ${mcpUrl} --header "Authorization: Bearer [REDACTED]"`}</pre>
              </div>
              <div>
                <p className="mb-1 font-medium">Cursor</p>
                <p className="mb-1 text-muted">
                  Settings → MCP → Add new server, or add to <code>.cursor/mcp.json</code>:
                </p>
                <pre className="overflow-x-auto rounded-md bg-subtle p-3 text-xs">{`{
  "mcpServers": {
    "persuna": {
      "url": "${mcpUrl}",
      "headers": { "Authorization": "Bearer [REDACTED]" }
    }
  }
}`}</pre>
              </div>
              <div>
                <p className="mb-1 font-medium">Claude Desktop</p>
                <p className="mb-1 text-muted">
                  Add to <code>claude_desktop_config.json</code> (the bridge forwards your key as
                  the header):
                </p>
                <pre className="overflow-x-auto rounded-md bg-subtle p-3 text-xs">{`{
  "mcpServers": {
    "persuna": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "${mcpUrl}", "--header", "Authorization: Bearer [REDACTED]"]
    }
  }
}`}</pre>
              </div>
              <div>
                <p className="mb-1 font-medium">Any other MCP host</p>
                <p className="text-muted">
                  Use a remote/streamable-HTTP server with URL <code>{mcpUrl}</code> and header{" "}
                  <code>Authorization: Bearer [REDACTED]</code>. ChatGPT&apos;s custom connectors
                  don&apos;t accept API-key headers yet (they expect OAuth), so ChatGPT can&apos;t
                  connect for now — Claude and Cursor can.
                </p>
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted">
            Deploy the Worker in <code>cloudflare/mcp-worker</code> (
            <code>npx wrangler deploy</code> there), set <code>MCP_SERVER_URL</code> to its{" "}
            <code>/mcp</code> address on this app, and this section fills in copy-ready setup
            instructions for Claude Code, Claude Desktop and Cursor.
          </p>
        )}
      </Card>

      <section className="space-y-3">
        <h2 className="font-display text-2xl font-medium tracking-[-0.02em]">Imports</h2>
        {imports.length === 0 ? (
          <p className="text-sm text-muted">Nothing received yet.</p>
        ) : (
          <ul className="space-y-3">
            {imports.map(({ import: imp, skill }) => {
              const r = imp.report;
              const status = STATUS[imp.status];
              const working = ["received", "training", "testing"].includes(imp.status);
              return (
                <li key={imp.id}>
                  <Card className="space-y-3 p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={status.tone}>{status.label}</Badge>
                      <span className="font-medium">{skill?.name ?? "New skill"}</span>
                      <span className="text-sm text-muted">
                        from {imp.agentName} · {date(imp.createdAt)}
                      </span>
                    </div>
                    <p className="text-sm text-muted">
                      {[
                        r.examples !== undefined && plural(r.examples, "example"),
                        r.test !== undefined && `${r.test} held back for testing`,
                        r.methodSteps !== undefined && plural(r.methodSteps, "method step"),
                        r.redactions !== undefined &&
                          plural(r.redactions, "name or identifier") + " redacted",
                        r.rules !== undefined && plural(r.rules, "rule"),
                        r.score != null && `scored ${r.score.toFixed(0)}/100 (needs ${r.minScore})`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      {working && " · Persuna is working on it; refresh to check."}
                    </p>
                    {imp.error && <p className="text-sm text-danger">{imp.error}</p>}
                    {(r.problems ?? []).length > 0 && (
                      <ul className="list-disc space-y-1 pl-5 text-sm text-warn">
                        {r.problems!.map((p) => (
                          <li key={p}>{p}</li>
                        ))}
                      </ul>
                    )}
                    <div className="flex flex-wrap items-start gap-3">
                      {skill && (
                        <Link
                          href={`/skills/${skill.slug}`}
                          className="label-mono py-2 text-accent hover:underline"
                        >
                          Open the skill →
                        </Link>
                      )}
                      {imp.status === "failed" && imp.skillId && (
                        <ActionForm
                          action={retryImportAction}
                          label="Test again"
                          pendingLabel="Starting…"
                          variant="secondary"
                        >
                          <input type="hidden" name="importId" value={imp.id} />
                        </ActionForm>
                      )}
                    </div>
                    {imp.status === "verified" && skill && !skill.publishedVersionId && (
                      <ActionForm
                        action={publishImportAction}
                        label="Publish and list"
                        pendingLabel="Publishing…"
                        variant="accent"
                        className="space-y-3 border-t border-line pt-3"
                      >
                        <input type="hidden" name="importId" value={imp.id} />
                        <div className="max-w-48">
                          <Field label="Price per task (US$)">
                            <input
                              name="price"
                              inputMode="decimal"
                              required
                              defaultValue="10"
                              className={inputClass}
                            />
                          </Field>
                        </div>
                        <label className="flex items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            name="declareOwnership"
                            required
                            className="mt-1"
                          />
                          <span>
                            I confirm this method is mine to list, and it contains no
                            client-confidential material.
                          </span>
                        </label>
                      </ActionForm>
                    )}
                    {imp.status === "verified" && skill?.publishedVersionId && (
                      <Link
                        href={`/skills/${skill.slug}/listing`}
                        className="label-mono text-accent hover:underline"
                      >
                        Published · manage its listing →
                      </Link>
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
