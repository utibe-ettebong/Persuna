import type { Metadata } from "next";
import { createSkillAction } from "@/app/actions/skills";
import { ActionForm } from "@/components/action-form";
import { Card, Field, inputClass, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "New skill" };

export default function NewSkillPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        back={{ href: "/skills", label: "Skills" }}
        title="Name the task"
        description="Pick one specific job, such as “turn raw meeting notes into our minutes format”, not “do my admin”."
      />
      <Card className="p-5">
        <ActionForm
          action={createSkillAction}
          label="Create skill and add examples"
          pendingLabel="Creating…"
          className="space-y-4"
        >
          <Field label="Task name">
            <input
              name="name"
              required
              maxLength={120}
              className={inputClass}
              placeholder="Meeting notes into minutes"
            />
          </Field>
          <Field label="What the task is" hint="One or two sentences">
            <textarea
              name="taskDescription"
              required
              rows={3}
              maxLength={1000}
              className={inputClass}
              placeholder="Turn raw meeting notes into finished minutes in our house format."
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="What goes in">
              <input
                name="inputType"
                required
                maxLength={120}
                className={inputClass}
                placeholder="Raw meeting notes"
              />
            </Field>
            <Field label="What comes out">
              <input
                name="outputType"
                required
                maxLength={120}
                className={inputClass}
                placeholder="Formatted minutes"
              />
            </Field>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
