import type { Metadata } from "next";
import { createProjectAction } from "@/app/actions/projects";
import { ActionForm } from "@/components/action-form";
import { Card, Field, inputClass, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Post a project" };

export default async function NewProjectPage() {
  await requireUser("/projects/new");
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const soon = new Date(now.getTime() + 14 * 86_400_000).toISOString().slice(0, 10);

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        back={{ href: "/projects", label: "Projects" }}
        title="Post a project"
        description="Describe the work in your own words. Persuna turns it into a clear scope, acceptance criteria and milestones, and points out anything vague or unfair before anyone sees it. You review and edit everything before it opens."
      />
      <Card className="p-5">
        <ActionForm
          action={createProjectAction}
          label="Ask Persuna to plan it"
          pendingLabel="Persuna is reading your brief…"
          className="space-y-4"
        >
          <Field label="Title">
            <input name="title" required minLength={5} maxLength={120} className={inputClass} />
          </Field>
          <Field label="Brief" hint="what you need, what done looks like, anything to avoid">
            <textarea
              name="brief"
              required
              minLength={40}
              maxLength={10_000}
              rows={10}
              className={inputClass}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Budget (US$)" hint="the total, e.g. 250">
              <input name="budget" inputMode="decimal" required className={inputClass} />
            </Field>
            <Field label="Deadline">
              <input
                name="deadline"
                type="date"
                required
                min={today}
                defaultValue={soon}
                className={inputClass}
              />
            </Field>
          </div>
          <p className="text-xs text-muted">
            The brief is your material: it&apos;s kept with the project and deleted after the
            retention period. It never becomes part of anyone&apos;s skill.
          </p>
        </ActionForm>
      </Card>
    </div>
  );
}
