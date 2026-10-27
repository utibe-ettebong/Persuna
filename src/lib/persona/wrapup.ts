/** The end-of-day wrap-up: built from what happened, with no model call, so nothing is invented. */
export interface DayRecord {
  name: string;
  focus: string | null;
  messages: number;
  notes: string[];
  jobs: { skill: string; status: string }[];
  done: string[];
  open: { text: string; due: string | null }[];
}

const list = (items: string[]) => items.map((i) => `• ${i}`).join("\n");

export function buildWrapUp(day: DayRecord): string {
  const parts: string[] = [];
  const idle =
    !day.focus && !day.messages && !day.notes.length && !day.jobs.length && !day.done.length;
  if (idle) {
    parts.push("Quiet day: we didn't work on anything together.");
  } else {
    parts.push(day.focus ? `Today we worked on ${day.focus}.` : "Here's today.");
  }
  if (day.jobs.length) {
    const approved = day.jobs.filter((j) => j.status === "approved").length;
    const waiting = day.jobs.filter((j) => j.status === "review").length;
    const bits = [`${day.jobs.length} task${day.jobs.length === 1 ? "" : "s"} drafted`];
    if (approved) bits.push(`${approved} approved`);
    if (waiting) bits.push(`${waiting} still waiting for your review`);
    parts.push(`Work: ${bits.join(", ")}.`);
  }
  if (day.notes.length) parts.push(`Notes I took:\n${list(day.notes)}`);
  if (day.done.length) parts.push(`Done:\n${list(day.done)}`);
  if (day.open.length) {
    parts.push(
      `Still open:\n${list(day.open.map((o) => (o.due ? `${o.text} (due ${o.due})` : o.text)))}`,
    );
  } else if (!idle) {
    parts.push("Nothing left open on your list.");
  }
  return parts.join("\n\n");
}
