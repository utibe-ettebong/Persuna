import Link from "next/link";
import {
  portfolioOrderAction,
  saveProfileAction,
  savePortfolioItemAction,
} from "@/app/actions/profile";
import { ActionForm } from "@/components/action-form";
import {
  Badge,
  Card,
  Field,
  PageHeader,
  PanelTitle,
  buttonClass,
  inputClass,
} from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { MAX_PORTFOLIO } from "@/lib/profile/rules";
import { myProfile } from "@/lib/profile/service";

export const metadata = { title: "Your profile" };

type Props = { searchParams: Promise<{ saved?: string; edit?: string }> };

/**
 * Your public profile and portfolio, as clients and renters see them: who
 * you are in a line, a short bio, and the work you want to show.
 */
export default async function ProfilePage({ searchParams }: Props) {
  const user = await requireUser();
  const { saved, edit } = await searchParams;
  const p = await myProfile(user.id);
  const editing = p.portfolio.find((r) => r.item.id === edit)?.item ?? null;

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Profile"
        title="Your public profile"
        description="What clients posting projects and people renting your skills see about you. Your email is never shown."
      >
        <Link href={`/persunas/${p.handle}`} className={buttonClass("secondary")}>
          See it as others do ↗
        </Link>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Card className="p-6">
          <PanelTitle>About you</PanelTitle>
          {saved === "profile" && (
            <p className="mt-2 text-sm text-good" role="status">
              Saved.
            </p>
          )}
          <ActionForm action={saveProfileAction} pendingLabel="Saving…" className="mt-4 space-y-4">
            <Field
              label="Name to show"
              hint={`Leave empty to show "${p.accountName.split(/\s+/)[0]}"`}
            >
              <input
                name="publicName"
                defaultValue={p.publicName ?? ""}
                maxLength={60}
                className={inputClass}
              />
            </Field>
            <Field label="Headline" hint="One line">
              <input
                name="headline"
                defaultValue={p.headline ?? ""}
                maxLength={120}
                placeholder="Board secretary · minutes and reports in plain English"
                className={inputClass}
              />
            </Field>
            <Field label="About" hint="A few sentences">
              <textarea
                name="bio"
                defaultValue={p.bio ?? ""}
                maxLength={1500}
                rows={5}
                placeholder="What you do, for whom, and how you like to work."
                className={inputClass}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Location">
                <input
                  name="location"
                  defaultValue={p.location ?? ""}
                  maxLength={80}
                  placeholder="Lagos, Nigeria"
                  className={inputClass}
                />
              </Field>
              <Field label="Website">
                <input
                  name="website"
                  defaultValue={p.website ?? ""}
                  placeholder="https://…"
                  className={inputClass}
                />
              </Field>
            </div>
          </ActionForm>
        </Card>

        <Card className="p-6">
          <div id="portfolio" className="flex items-baseline justify-between">
            <PanelTitle>Portfolio</PanelTitle>
            <span className="label-mono text-faint">
              {p.portfolio.length} / {MAX_PORTFOLIO}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted">
            Work you&apos;re proud of: what it was, what you did, and a link to see it. Write it
            yourself; nothing from your jobs or projects is copied here.
          </p>
          {saved === "portfolio" && (
            <p className="mt-2 text-sm text-good" role="status">
              Saved.
            </p>
          )}
          <ul className="mt-4 divide-y divide-line">
            {p.portfolio.map(({ item, skill }, i) => (
              <li key={item.id} className="flex items-start gap-3 py-3">
                {item.imageUrl ? (
                  // Pictures live on the person's own site; they're shown as they are.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.imageUrl}
                    alt=""
                    className="h-14 w-20 shrink-0 rounded-sm border border-line object-cover"
                  />
                ) : (
                  <span className="grid h-14 w-20 shrink-0 place-items-center rounded-sm border border-line bg-subtle font-display text-lg text-faint">
                    {item.title[0]}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{item.title}</p>
                  <p className="line-clamp-2 text-sm text-muted">{item.description}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {skill?.name && <Badge tone="accent">{skill.name}</Badge>}
                    {item.link && <Badge>Link</Badge>}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Link
                    href={`/profile?edit=${item.id}#portfolio-form`}
                    className="label-mono text-muted hover:text-accent"
                  >
                    Edit
                  </Link>
                  <ActionForm
                    action={portfolioOrderAction}
                    pendingLabel="…"
                    className="flex gap-1"
                    buttons={[
                      ...(i > 0
                        ? [{ label: "↑", intent: "up", variant: "secondary" as const }]
                        : []),
                      ...(i < p.portfolio.length - 1
                        ? [{ label: "↓", intent: "down", variant: "secondary" as const }]
                        : []),
                      { label: "Remove", intent: "remove", variant: "secondary" as const },
                    ]}
                  >
                    <input type="hidden" name="itemId" value={item.id} />
                  </ActionForm>
                </div>
              </li>
            ))}
            {!p.portfolio.length && (
              <li className="py-4 text-sm text-faint">Nothing yet. Add your first piece below.</li>
            )}
          </ul>

          <div id="portfolio-form" className="mt-4 border-t border-line pt-4">
            <p className="label-mono text-faint">{editing ? "Edit this piece" : "Add a piece"}</p>
            <ActionForm
              key={editing?.id ?? "new"}
              action={savePortfolioItemAction}
              label={editing ? "Save piece" : "Add to portfolio"}
              pendingLabel="Saving…"
              className="mt-3 space-y-3"
            >
              <input type="hidden" name="itemId" value={editing?.id ?? ""} />
              <Field label="Title">
                <input
                  name="title"
                  required
                  defaultValue={editing?.title ?? ""}
                  maxLength={100}
                  placeholder="Quarterly board pack"
                  className={inputClass}
                />
              </Field>
              <Field label="What it was, and what you did">
                <textarea
                  name="description"
                  rows={3}
                  defaultValue={editing?.description ?? ""}
                  maxLength={1000}
                  className={inputClass}
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Link" hint="https">
                  <input
                    name="link"
                    defaultValue={editing?.link ?? ""}
                    placeholder="https://…"
                    className={inputClass}
                  />
                </Field>
                <Field label="Picture" hint="https address of an image">
                  <input
                    name="imageUrl"
                    defaultValue={editing?.imageUrl ?? ""}
                    placeholder="https://…/cover.png"
                    className={inputClass}
                  />
                </Field>
              </div>
              {p.skills.length > 0 && (
                <Field label="Shows which skill?" hint="Optional">
                  <select
                    name="skill"
                    defaultValue={
                      p.skills.find((s) =>
                        p.portfolio.some(
                          (r) => r.item.id === editing?.id && r.skill?.slug === s.slug,
                        ),
                      )?.slug ?? ""
                    }
                    className={inputClass}
                  >
                    <option value="">None</option>
                    {p.skills.map((s) => (
                      <option key={s.slug} value={s.slug}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </ActionForm>
            {editing && (
              <Link
                href="/profile#portfolio"
                className="label-mono mt-2 inline-block text-muted hover:text-foreground"
              >
                Cancel editing
              </Link>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
