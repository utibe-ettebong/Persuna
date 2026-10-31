import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui";
import { env } from "@/env";
import {
  dailyCallsPerUser,
  jobsWithoutCorrectionByTrust,
  proposalOutcomes,
  screenReadsOutside,
  sixLayerShare,
  weeklyEpisodes,
  weeklyVoiceLatency,
  type LatencySummary,
} from "@/lib/admin/measures";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin · Measures" };

const ms = (value: number | null) =>
  value === null ? (
    <span className="text-faint">—</span>
  ) : (
    `${Math.round(value).toLocaleString()} ms`
  );

function Latency({ summary }: { summary: LatencySummary }) {
  if (summary.n === 0) return <span className="text-faint">—</span>;
  return (
    <span className="tabular-nums">
      {ms(summary.p50)} <span className="text-muted">/ {ms(summary.p95)}</span>
    </span>
  );
}

function Th({ children, right = false }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`py-2 pr-3 font-semibold last:pr-0 ${right ? "text-right" : ""}`}>{children}</th>
  );
}

function Td({ children, right = false }: { children: React.ReactNode; right?: boolean }) {
  return (
    <td
      className={`border-t border-line py-2 pr-3 tabular-nums last:pr-0 ${right ? "text-right" : ""}`}
    >
      {children}
    </td>
  );
}

/** The plan's measures (§9), read off the tables the app already keeps. Admins only. */
export default async function AdminMeasuresPage() {
  const [latency, episodes, proposals, layers, trust, spend, violations] = await Promise.all([
    weeklyVoiceLatency(),
    weeklyEpisodes(),
    proposalOutcomes(),
    sixLayerShare(),
    jobsWithoutCorrectionByTrust(),
    dailyCallsPerUser(),
    screenReadsOutside(),
  ]);
  const allowance = env().DAILY_MODEL_CALLS_PER_USER;
  const proposalTotal = proposals.accepted + proposals.rejected;
  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/admin", label: "Admin" }}
        title="Measures"
        description="How fast, how learned, and how clean: the plan's weekly numbers."
      />

      <Card className="space-y-2 p-5">
        <p className="label-mono text-muted">Voice timing per week (p50 / p95)</p>
        {latency.length === 0 ? (
          <p className="text-sm text-muted">No turns recorded yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="label-mono border-b border-line text-muted">
              <tr>
                <Th>Week</Th>
                <Th right>First token</Th>
                <Th right>First sentence</Th>
                <Th right>First sound</Th>
                <Th right>Turns</Th>
              </tr>
            </thead>
            <tbody>
              {latency.map((week) => (
                <tr key={week.week}>
                  <Td>{week.week}</Td>
                  <Td right>
                    <Latency summary={week.firstToken} />
                  </Td>
                  <Td right>
                    <Latency summary={week.firstSentence} />
                  </Td>
                  <Td right>
                    <Latency summary={week.firstAudio} />
                  </Td>
                  <Td right>{week.turns}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-2 p-5">
          <p className="label-mono text-muted">Episodes per active user per week</p>
          {episodes.length === 0 ? (
            <p className="text-sm text-muted">No episodes recorded yet.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="label-mono border-b border-line text-muted">
                <tr>
                  <Th>Week</Th>
                  <Th right>Episodes</Th>
                  <Th right>Users</Th>
                  <Th right>Per user</Th>
                </tr>
              </thead>
              <tbody>
                {episodes.map((week) => (
                  <tr key={week.week}>
                    <Td>{week.week}</Td>
                    <Td right>{week.episodes}</Td>
                    <Td right>{week.users}</Td>
                    <Td right>{week.perUser}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card className="space-y-2 p-5">
          <p className="label-mono text-muted">Learning proposals</p>
          <p className="text-sm">
            <span className="font-display text-2xl tabular-nums">{proposals.accepted}</span>{" "}
            <span className="text-muted">accepted ·</span>{" "}
            <span className="font-display text-2xl tabular-nums">{proposals.rejected}</span>{" "}
            <span className="text-muted">rejected</span>
          </p>
          <p className="text-sm text-muted">
            {proposalTotal === 0
              ? "Nothing decided yet."
              : `${Math.round((proposals.accepted / proposalTotal) * 100)}% accepted.`}
          </p>
          <p className="label-mono pt-3 text-muted">Six-layer coverage</p>
          <p className="text-sm">
            <span className="font-display text-2xl tabular-nums">{layers.full}</span>{" "}
            <span className="text-muted">
              of {layers.published} published skills cover all six layers
            </span>
          </p>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-2 p-5">
          <p className="label-mono text-muted">Jobs delivered without correction, by trust level</p>
          {trust.length === 0 ? (
            <p className="text-sm text-muted">No delivered jobs yet.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="label-mono border-b border-line text-muted">
                <tr>
                  <Th>Trust</Th>
                  <Th right>Delivered</Th>
                  <Th right>Without correction</Th>
                </tr>
              </thead>
              <tbody>
                {trust.map((row) => (
                  <tr key={row.trustLevel}>
                    <Td>Level {row.trustLevel}</Td>
                    <Td right>{row.delivered}</Td>
                    <Td right>
                      {row.withoutCorrection} (
                      {Math.round((row.withoutCorrection / row.delivered) * 100)}
                      %)
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card className="space-y-2 p-5">
          <p className="label-mono text-muted">
            Calls per active user per day (allowance {allowance}/day)
          </p>
          {spend.length === 0 ? (
            <p className="text-sm text-muted">No calls recorded yet.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="label-mono border-b border-line text-muted">
                <tr>
                  <Th>Day</Th>
                  <Th right>Model</Th>
                  <Th right>Voice</Th>
                  <Th right>Transcription</Th>
                  <Th right>Users</Th>
                </tr>
              </thead>
              <tbody>
                {spend.map((day) => (
                  <tr key={day.day}>
                    <Td>{day.day}</Td>
                    <Td right>{(day.model / day.users).toFixed(1)}</Td>
                    <Td right>{(day.voice / day.users).toFixed(1)}</Td>
                    <Td right>{(day.transcription / day.users).toFixed(1)}</Td>
                    <Td right>{day.users}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card className="space-y-2 p-5">
        <p className="label-mono text-muted">Screen reads outside Work or Look</p>
        {violations.length === 0 ? (
          <p className="text-sm text-good">Zero. Every read was in Work or Look mode.</p>
        ) : (
          <>
            <p className="text-sm text-danger">
              {violations.length} read{violations.length === 1 ? "" : "s"} outside Work or Look — a
              privacy bug. Newest first:
            </p>
            <ul className="space-y-1 text-sm">
              {violations.map((v, i) => (
                <li key={i} className="tabular-nums">
                  {v.at.toISOString()} · {v.actor} · mode: {String(v.mode)}
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
