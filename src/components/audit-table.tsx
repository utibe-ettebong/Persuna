import type { AuditEvent } from "@/db/schema";
import { Card } from "./ui";

const formatter = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

function describe(details: Record<string, unknown>): string {
  return Object.entries(details)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") || "none" : String(v)}`)
    .join(" · ");
}

/** A read-only list of audit events, newest first. */
export function AuditTable({ events }: { events: AuditEvent[] }) {
  if (events.length === 0) return <p className="text-sm text-muted">Nothing recorded yet.</p>;
  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-line label-mono text-muted">
          <tr>
            <th className="p-3 font-semibold">When</th>
            <th className="p-3 font-semibold">Who</th>
            <th className="p-3 font-semibold">What</th>
            <th className="p-3 font-semibold">Details</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {events.map((e) => (
            <tr key={e.id} className="align-top">
              <td className="whitespace-nowrap p-3 tabular-nums text-muted">
                {formatter.format(e.at)}
              </td>
              <td className="whitespace-nowrap p-3">{e.actor}</td>
              <td className="whitespace-nowrap p-3 font-mono text-xs">{e.action}</td>
              <td className="p-3 text-xs text-muted">{describe(e.details)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
