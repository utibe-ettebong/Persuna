import type { Metadata } from "next";
import { Badge, Card, PageHeader } from "@/components/ui";
import { env, modelProvider, modelSettingsStatus } from "@/env";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Models & keys" };

const ROLE_INFO = {
  extract: {
    name: "Learn",
    model: "Muse Spark (Meta Model API)",
    use: "Extracts rules, finds names, turns corrections and interviews into rule changes.",
  },
  draft: {
    name: "Draft",
    model: "Muse Spark Open on Baseten",
    use: "Drafts test runs and real jobs.",
  },
  evaluate: {
    name: "Score",
    model: "Muse Spark Open (Modal or Baseten)",
    use: "Scores drafts and runs the self-check.",
  },
  transcribe: {
    name: "Transcribe",
    model: "Muse Voice Transcribe",
    use: "Voice walkthroughs and voice-note jobs.",
  },
} as const;

/** Which models are connected. Shows settings, never key values. */
export default function SettingsPage() {
  const roles = modelSettingsStatus();
  const mock = modelProvider() === "mock";
  const payments = env().PAYMENTS_PROVIDER;

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Studio · Settings"
        title="Models & keys"
        description="Keys are set as Railway variables, never in the app. Paste a key into its slot in Railway (service Persuna → Variables); the app redeploys and switches from the mock models to the real ones."
      />

      <Card className={`p-5 ${mock ? "border-warn/50" : "border-good/50"}`}>
        <p className="flex flex-wrap items-center gap-3">
          {mock ? <Badge tone="warn">Mock models</Badge> : <Badge tone="good">Live models</Badge>}
          <span className="text-sm text-muted">
            {mock
              ? "No real EXTRACT_API_KEY yet, so every role uses the offline mock. Everything works; drafts are rough and scores are text overlap."
              : "Real models are connected. Roles without their own key use the Learn role's settings."}
          </span>
        </p>
      </Card>

      <div className="grid gap-px overflow-hidden rounded-md border border-line bg-line md:grid-cols-2">
        {roles.map((r) => {
          const info = ROLE_INFO[r.role];
          return (
            <section key={r.role} className="space-y-4 bg-card p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="label-mono text-faint">{r.prefix}_*</p>
                  <h2 className="mt-1 font-display text-xl font-medium tracking-[-0.02em]">
                    {info.name}
                  </h2>
                  <p className="mt-1 text-sm text-muted">{info.use}</p>
                </div>
                {r.ownKey ? (
                  <Badge tone="good">Key set</Badge>
                ) : r.keySet ? (
                  <Badge tone="accent">Uses Learn key</Badge>
                ) : (
                  <Badge tone="warn">Waiting for key</Badge>
                )}
              </div>
              <dl className="space-y-2 text-sm">
                <Row label="Intended model" value={info.model} />
                <Row label="Base URL" value={r.baseUrl ?? "not set"} mono />
                <Row label="Model ID" value={r.model ?? "not set"} mono />
                <Row label="Key slot" value={`${r.prefix}_API_KEY`} mono />
              </dl>
            </section>
          );
        })}
      </div>

      <Card className="p-5 text-sm">
        <p className="label-mono text-muted">Payments</p>
        <p className="mt-2">
          {payments === "paystack" ? (
            <>
              <Badge tone="good">Paystack</Badge> Renters pay through Paystack checkout.
            </>
          ) : (
            <>
              <Badge>Mock</Badge> Payments are recorded without moving money. Set{" "}
              <code className="font-mono">PAYMENTS_PROVIDER=paystack</code> and{" "}
              <code className="font-mono">PAYSTACK_SECRET_KEY</code> to collect real payments.
            </>
          )}
        </p>
      </Card>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-line pt-2">
      <dt className="text-muted">{label}</dt>
      <dd className={`break-all text-right ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}
