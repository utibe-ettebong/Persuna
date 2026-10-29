import Link from "next/link";
import {
  addNoteAction,
  addTodoAction,
  deleteNoteAction,
  deleteReminderAction,
  reminderDoneAction,
} from "@/app/actions/persuna";
import { AddNoteForm, AddTodoForm } from "@/components/persuna/add-note-form";
import { LocalTime } from "@/components/persuna/local-time";
import {
  ClearChatButton,
  DisconnectAppButton,
  ForgetButton,
  PersunaProfileForm,
  TeachNoteButton,
  ToneForm,
} from "@/components/persuna/persuna-settings";
import { Badge, Card, PageHeader, PanelTitle, Prose } from "@/components/ui";
import { PersunaOrb } from "@/components/persuna/orb";
import { requireUser } from "@/lib/auth/session";
import { listConnections } from "@/lib/connections/service";
import { DESKTOP_DOWNLOAD_URL } from "@/lib/persuna/looks";
import {
  coachingForAll,
  companion,
  ensureHandle,
  listNotes,
  listReminders,
  toneSummary,
} from "@/lib/persuna/service";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ apps?: string }> };

export default async function PersunaPage({ searchParams }: Props) {
  const user = await requireUser();
  const appsMessage = (await searchParams).apps?.slice(0, 200) ?? null;
  const [{ profile, focusSkill, messages }, notes, reminders, coaching, handle, tone] =
    await Promise.all([
      companion(user.id),
      listNotes(user.id),
      listReminders(user.id),
      coachingForAll(user.id),
      ensureHandle(user.id),
      toneSummary(user.id),
    ]);
  const apps = await listConnections(user.id);

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Studio · My Persuna"
        title={
          <>
            <span className="inline-flex items-center gap-3">
              <PersunaOrb look={profile.avatar} size={56} />
              {profile.name}
            </span>
          </>
        }
        description={
          <>
            Your assistant. It sits in the corner of every page. Tap it, or press ⌃⌥P (Ctrl+Alt+P on
            Windows), and just talk: what you&apos;re working on, notes, reminders, a task. Say
            &ldquo;watch my screen&rdquo; and it learns your steps. It only watches when you say so.
            What it learns goes to your skills as changes you approve, and good skills can be rented
            in the marketplace.
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <div className="space-y-6">
          <Card className="p-5">
            <PanelTitle>Profile</PanelTitle>
            <PersunaProfileForm name={profile.name} avatar={profile.avatar} focus={profile.focus} />
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
            <PanelTitle>How {profile.name} talks to you</PanelTitle>
            <p className="mb-4 text-sm text-muted">
              Pick, or just tell {profile.name} (&ldquo;keep it short&rdquo;, &ldquo;you can
              joke&rdquo;). Anything left on &ldquo;Notice for me&rdquo; follows how you write.
            </p>
            <ToneForm tone={tone.explicit} instruction={tone.instruction} />
          </Card>

          <Card className="p-5">
            <PanelTitle>{profile.name} on your desktop</PanelTitle>
            <p className="text-sm text-muted">
              Persuna Desktop puts {profile.name} over your whole screen, above every app. It can
              watch any app you work in once you allow it, without sharing a window each time. For
              Mac (Apple silicon and Intel) and Windows.
            </p>
            <Link
              href={DESKTOP_DOWNLOAD_URL}
              className="label-mono mt-3 inline-block text-accent underline"
            >
              Get the desktop app →
            </Link>
          </Card>

          <Card className="p-5">
            <PanelTitle>Public profile</PanelTitle>
            <p className="text-sm text-muted">
              Renters see your persuna&apos;s name, its listed skills and scores, how many people
              rent it, and their reviews. Never your notes, memory or chats.
            </p>
            <Link
              href={`/persunas/${handle}`}
              className="label-mono mt-3 inline-block text-accent underline"
            >
              /persunas/{handle} →
            </Link>
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

          <span id="apps" className="block scroll-mt-24" />
          <Card className="p-5">
            <PanelTitle>Apps {profile.name} can use</PanelTitle>
            <p className="mb-3 text-sm text-muted">
              Connect an app and just ask: &ldquo;what did Ada email me about?&rdquo;, &ldquo;put
              lunch with Sam on Friday at 1&rdquo;, &ldquo;add these notes to Notion&rdquo;.{" "}
              {profile.name} asks before sending or creating anything.
            </p>
            {appsMessage && <p className="mb-3 text-sm text-accent">{appsMessage}</p>}
            <ul className="divide-y divide-line">
              {apps.map((app) => (
                <li key={app.provider} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                  <span className="flex-1">
                    <strong>{app.apps}</strong>
                    {app.account && <span className="block text-muted">{app.account}</span>}
                  </span>
                  {app.account ? (
                    <DisconnectAppButton provider={app.provider} name={app.name} />
                  ) : app.available ? (
                    <a
                      href={`/api/connections/${app.provider}`}
                      className="label-mono text-accent underline"
                    >
                      Connect
                    </a>
                  ) : (
                    <span className="label-mono text-faint">Not set up on this server</span>
                  )}
                </li>
              ))}
            </ul>
          </Card>

          <span id="conversation" className="block scroll-mt-24" />
          <Card className="p-5">
            <PanelTitle>Conversation</PanelTitle>
            <p className="mb-3 text-sm text-muted">
              Everything you and {profile.name} said, newest last. It stays private to you. Clearing
              it doesn&apos;t touch notes, memory or skills.
            </p>
            {messages.length > 0 && (
              <ol className="mb-4 max-h-96 space-y-2 overflow-y-auto text-sm">
                {messages.slice(-40).map((m) => (
                  <li key={m.id} className={m.role === "user" ? "text-right" : ""}>
                    <span
                      className={`inline-block max-w-[90%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-left ${
                        m.role === "user" ? "bg-accent-soft" : "bg-foreground/5"
                      }`}
                    >
                      {m.content}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            <ClearChatButton />
          </Card>
        </div>

        <div className="space-y-10">
          {coaching.length > 0 && (
            <section className="space-y-3" aria-labelledby="coach-heading">
              <h2
                id="coach-heading"
                className="font-display text-2xl font-medium tracking-[-0.02em]"
              >
                Your skills
              </h2>
              <ul className="space-y-2">
                {coaching.map((c) => (
                  <li key={c.href + c.message}>
                    <Card className="flex flex-wrap items-center gap-3 p-4 text-sm">
                      <span className="flex-1">{c.message}</span>
                      <Link href={c.href} className="label-mono text-accent underline">
                        {c.action} →
                      </Link>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section id="todos" className="space-y-3" aria-labelledby="todos-heading">
            <h2 id="todos-heading" className="font-display text-2xl font-medium tracking-[-0.02em]">
              To-dos and reminders
            </h2>
            <Card className="p-4">
              <AddTodoForm action={addTodoAction} />
              {reminders.open.length === 0 ? (
                <p className="mt-3 text-sm text-muted">
                  Nothing open. Tell {profile.name} &ldquo;remind me at 4pm to send the
                  minutes&rdquo;.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-line">
                  {reminders.open.map((r) => (
                    <li key={r.id} className="flex items-center gap-3 py-2 text-sm">
                      <form action={reminderDoneAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="done" value="true" />
                        <button
                          type="submit"
                          aria-label={`Mark "${r.text}" done`}
                          className="grid h-5 w-5 place-items-center rounded border border-line-strong hover:border-accent"
                        />
                      </form>
                      <span className="flex-1">{r.text}</span>
                      {r.dueAt && <LocalTime iso={r.dueAt.toISOString()} />}
                      <form action={deleteReminderAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <button type="submit" className="label-mono text-muted hover:text-danger">
                          Delete
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
              {reminders.done.length > 0 && (
                <details className="mt-3 text-sm">
                  <summary className="label-mono cursor-pointer text-muted">
                    Done ({reminders.done.length})
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {reminders.done.map((r) => (
                      <li key={r.id} className="flex items-center gap-3">
                        <span className="flex-1 text-muted line-through">{r.text}</span>
                        <form action={reminderDoneAction}>
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="done" value="false" />
                          <button type="submit" className="label-mono text-muted">
                            Undo
                          </button>
                        </form>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </Card>
          </section>

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
    </div>
  );
}
