import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { deleteHandbookNoteAction, saveHandbookNoteAction } from "@/app/actions/teams";
import { ActionForm } from "@/components/action-form";
import { TeamTabs } from "@/components/team";
import { Badge, Card, Field, inputClass, PageHeader, PanelTitle, Prose } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { orNotFound } from "@/lib/load";
import { HANDBOOK_KINDS, handbookView, membershipsOf } from "@/lib/teams/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Handbook" };

type Props = { searchParams: Promise<{ org?: string }> };

const KIND_LABELS: Record<(typeof HANDBOOK_KINDS)[number], string> = {
  values: "Values",
  tools: "Tools",
  process: "Process",
  other: "Other",
};

function NoteFields({
  orgId,
  note,
}: {
  orgId: string;
  note?: { id: string; kind: string; title: string; body: string };
}) {
  return (
    <>
      <input type="hidden" name="orgId" value={orgId} />
      {note && <input type="hidden" name="noteId" value={note.id} />}
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <Field label="Kind">
          <select name="kind" defaultValue={note?.kind ?? "process"} className={inputClass}>
            {HANDBOOK_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Title">
          <input
            name="title"
            required
            maxLength={120}
            defaultValue={note?.title}
            className={inputClass}
          />
        </Field>
      </div>
      <Field label="How it works here">
        <textarea
          name="body"
          required
          rows={6}
          maxLength={10_000}
          defaultValue={note?.body}
          className={inputClass}
        />
      </Field>
    </>
  );
}

export default async function HandbookPage({ searchParams }: Props) {
  const user = await requireUser("/team");
  const { org: slug } = await searchParams;
  const memberships = await membershipsOf(user.id);
  const chosen = memberships.find((m) => m.org.slug === slug) ?? memberships[0];
  if (!chosen) notFound();
  const { org, admin, notes } = await orNotFound(() => handbookView(user, chosen.org.id));
  const back = `/team/handbook?org=${org.slug}`;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Team"
        title={`How ${org.name} works`}
        description="The company handbook: values, tools and processes, in your own words. Persuna uses it to build each role's playbook and to teach new hires. Confidential to the organisation."
      />
      <TeamTabs slug={org.slug} active="Handbook" />

      {notes.length === 0 && (
        <p className="text-sm text-muted">
          {admin
            ? "Nothing written yet. Start with your values and the tools everyone uses."
            : "Your admins haven't written the handbook yet."}
        </p>
      )}

      {notes.map((n) => (
        <Card key={n.id} className="p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-medium">{n.title}</h2>
            <Badge>{KIND_LABELS[n.kind as keyof typeof KIND_LABELS] ?? n.kind}</Badge>
          </div>
          <div className="mt-2">
            <Prose>{n.body}</Prose>
          </div>
          {admin && (
            <details className="mt-4">
              <summary className="label-mono cursor-pointer text-muted">Edit</summary>
              <ActionForm
                action={saveHandbookNoteAction}
                label="Save"
                pendingLabel="Saving…"
                className="mt-3 space-y-3"
              >
                <NoteFields orgId={org.id} note={n} />
              </ActionForm>
              <ActionForm
                action={deleteHandbookNoteAction}
                label="Delete note"
                pendingLabel="Deleting…"
                variant="danger"
                className="mt-3"
              >
                <input type="hidden" name="noteId" value={n.id} />
                <input type="hidden" name="back" value={back} />
              </ActionForm>
            </details>
          )}
        </Card>
      ))}

      {admin && (
        <Card className="p-5">
          <PanelTitle>Add a note</PanelTitle>
          <ActionForm
            action={saveHandbookNoteAction}
            label="Add to handbook"
            pendingLabel="Saving…"
            className="space-y-3"
          >
            <NoteFields orgId={org.id} />
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
