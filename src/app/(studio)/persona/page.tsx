import Link from "next/link";
import { addNoteAction, deleteNoteAction } from "@/app/actions/persona";
import { AddNoteForm } from "@/components/persona/add-note-form";
import {
  ClearChatButton,
  ForgetButton,
  PersonaProfileForm,
  TeachNoteButton,
} from "@/components/persona/persona-settings";
import { Badge, Card, PageHeader, PanelTitle, Prose } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { AVATARS, companion, listNotes } from "@/lib/persona/service";

export const dynamic = "force-dynamic";

export default async function PersonaPage() {
  const user = await requireUser();
  const [{ profile, focusSkill }, notes] = await Promise.all([
    companion(user.id),
    listNotes(user.id),
  ]);

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Studio · Persona"
        title={
          <>
            <span aria-hidden>{profile.avatar}</span> {profile.name}
          </>
        }
        description={
          <>
            Your assistant. It sits in the corner of every page: tell it what you&apos;re working
            on, ask it to take notes or remember things, talk to it, or let it watch one window to
            learn your steps. It only watches when you say so. What it learns goes to your skills as
            changes you approve, and good skills can be rented in the marketplace.
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <div className="space-y-6">
          <Card className="p-5">
            <PanelTitle>Profile</PanelTitle>
            <PersonaProfileForm
              name={profile.name}
              avatar={profile.avatar}
              focus={profile.focus}
              avatars={AVATARS}
            />
            {focusSkill && (
              <p className="mt-3 text-sm text-muted">
                Learning into{" "}
                <Link href={`/skills/${focusSkill.slug}`} className="text-accent underline">
                  {focusSkill.name}
                </Link>
                .
              </p>
            )}
          </Card>

          <Card className="p-5">
            <PanelTitle>What {profile.name} remembers</PanelTitle>
            {profile.memory.length === 0 ? (
              <p className="text-sm text-muted">
                Nothing yet. Say &ldquo;remember that I send minutes by 5pm&rdquo;.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {profile.memory.map((fact, i) => (
                  <li key={`${i}-${fact}`} className="flex items-start gap-3 py-2 text-sm">
                    <span className="flex-1">{fact}</span>
                    <ForgetButton index={i} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-5">
            <PanelTitle>Conversation</PanelTitle>
            <p className="mb-3 text-sm text-muted">
              Your chat history stays private to you. Clearing it doesn&apos;t touch notes, memory
              or skills.
            </p>
            <ClearChatButton />
          </Card>
        </div>

        <section className="space-y-4" aria-labelledby="notes-heading">
          <h2 id="notes-heading" className="font-display text-2xl font-medium tracking-[-0.02em]">
            Notes
          </h2>
          <Card className="p-5">
            <AddNoteForm action={addNoteAction} />
          </Card>
          {notes.length === 0 ? (
            <p className="text-sm text-muted">
              No notes yet. Ask {profile.name} to &ldquo;take a note: …&rdquo;, or let it watch a
              window while you work.
            </p>
          ) : (
            <ul className="space-y-3">
              {notes.map(({ note, skillName }) => (
                <li key={note.id}>
                  <Card className="p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium">{note.title}</h3>
                      {note.source === "screen" && <Badge tone="accent">Watched</Badge>}
                      {skillName && <Badge>{skillName}</Badge>}
                      <span className="label-mono ml-auto text-faint">
                        {note.createdAt.toLocaleString("en-GB", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </span>
                    </div>
                    <div className="mt-2 text-muted">
                      <Prose>{note.body}</Prose>
                    </div>
                    <div className="mt-3 flex items-center gap-4">
                      {(skillName ?? focusSkill?.name) && (
                        <TeachNoteButton
                          noteId={note.id}
                          skillName={(skillName ?? focusSkill?.name)!}
                        />
                      )}
                      <form action={deleteNoteAction} className="ml-auto">
                        <input type="hidden" name="noteId" value={note.id} />
                        <button type="submit" className="label-mono text-muted hover:text-danger">
                          Delete
                        </button>
                      </form>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
