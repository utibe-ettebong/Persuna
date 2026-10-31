import type { Metadata } from "next";
import {
  chatImportAction,
  saveInterviewAction,
  screenWalkthroughAction,
  voiceWalkthroughAction,
} from "@/app/actions/skills";
import { ActionForm } from "@/components/action-form";
import { Card, Field, inputClass, PageHeader, SkillTabs } from "@/components/ui";
import { ScreenWalkthrough } from "@/components/screen-walkthrough";
import { VoiceRecorder } from "@/components/voice-recorder";
import { orNotFound } from "@/lib/load";
import { INTERVIEW_QUESTIONS, LAYER_NAMES, type Layer } from "@/lib/skill/interview";
import { getSkillBySlug } from "@/lib/skill/service";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    saved?: string;
    transcribed?: string;
    screen?: string;
    imported?: string;
  }>;
};

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const skill = await orNotFound(async () => getSkillBySlug((await params).slug));
  return { title: `Interview · ${skill.name}` };
}

export default async function InterviewPage({ params, searchParams }: Params) {
  const skill = await orNotFound(async () => getSkillBySlug((await params).slug));
  const { saved, transcribed, screen, imported } = await searchParams;
  const hasRules = Boolean(skill.currentVersionId);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Skill"
        title={skill.name}
        description="Tell the agent how you do this, in your own words. Your answers sit alongside your examples."
      />
      <SkillTabs slug={skill.slug} active="Interview" />

      {screen && (
        <p role="status" className="rounded-md bg-good/10 p-3 text-sm text-good">
          Your screen walkthrough was turned into steps (names and numbers removed) and added to
          your first answer. Rule extraction will use it.
        </p>
      )}

      {(saved || transcribed) && (
        <p role="status" className="rounded-md bg-good/10 p-3 text-sm text-good">
          {transcribed
            ? "Your walkthrough was transcribed and added to your first answer. Rule extraction will use it."
            : "Answers saved."}
        </p>
      )}

      {imported && (
        <p role="status" className="rounded-md bg-good/10 p-3 text-sm text-good">
          Your chat history was imported into the tools answer (shapes only, names removed). Rule
          extraction will use it.
        </p>
      )}

      <section aria-labelledby="interview-heading">
        <h2
          id="interview-heading"
          className="mb-1 font-display text-lg font-medium tracking-[-0.02em]"
        >
          Guided interview
        </h2>
        <p className="mb-4 text-sm text-muted">
          {hasRules
            ? "Saving keeps your answers. “Turn into rules” proposes changes to the working version for you to accept or reject."
            : "Your answers are used the first time you extract rules from your examples."}
        </p>
        <Card className="p-5">
          <ActionForm
            action={saveInterviewAction}
            pendingLabel="Saving…"
            className="space-y-5"
            buttons={[
              {
                label: "Save answers",
                intent: "save",
                variant: hasRules ? "secondary" : "primary",
              },
              ...(hasRules ? [{ label: "Save and turn into rules", intent: "propose" }] : []),
            ]}
          >
            <input type="hidden" name="slug" value={skill.slug} />
            {([1, 2, 3, 4, 5, 6] as Layer[]).map((layer) => (
              <fieldset key={layer} className="space-y-5">
                <legend className="label-mono text-muted">
                  Layer {layer} · {LAYER_NAMES[layer]}
                </legend>
                {INTERVIEW_QUESTIONS.filter((q) => q.layer === layer).map((q) => (
                  <Field key={q.key} label={q.question} hint={q.hint}>
                    <textarea
                      name={q.key}
                      rows={3}
                      maxLength={4000}
                      defaultValue={skill.interview?.[q.key] ?? ""}
                      className={inputClass}
                    />
                  </Field>
                ))}
              </fieldset>
            ))}
          </ActionForm>
        </Card>
      </section>

      <section aria-labelledby="voice-heading">
        <h2 id="voice-heading" className="mb-1 font-display text-lg font-medium tracking-[-0.02em]">
          Voice walkthrough
        </h2>
        <p className="mb-4 text-sm text-muted">
          Talk through how you do this task, as if training a new colleague. The recording is
          transcribed, then{" "}
          {hasRules ? "turned into proposed rule changes" : "added to your interview answers"}. Only
          the transcript&apos;s method is kept: avoid naming clients.
        </p>
        <Card className="p-5">
          <ActionForm
            action={voiceWalkthroughAction}
            label="Transcribe and learn from it"
            pendingLabel="Transcribing…"
            className="space-y-4"
          >
            <input type="hidden" name="slug" value={skill.slug} />
            <VoiceRecorder />
          </ActionForm>
        </Card>
      </section>

      <section aria-labelledby="chats-heading">
        <h2 id="chats-heading" className="mb-1 font-display text-lg font-medium tracking-[-0.02em]">
          AI chat history
        </h2>
        <p className="mb-4 text-sm text-muted">
          Share a ChatGPT or Claude export (conversations.json, up to 5 MB). Persuna keeps the shape
          of your prompting — how long, pastes, refinement turns, what you corrected the AI on — and{" "}
          {hasRules ? "proposes rule changes for you to review" : "adds it to your tools answer"}.
          Paste contents and replies are never kept.
        </p>
        <Card className="p-5">
          <ActionForm
            action={chatImportAction}
            label="Import chat history"
            pendingLabel="Reading your chats…"
            className="space-y-4"
          >
            <input type="hidden" name="slug" value={skill.slug} />
            <Field label="Export file" hint="conversations.json from ChatGPT or Claude settings">
              <input type="file" name="export" accept=".json,application/json" />
            </Field>
          </ActionForm>
        </Card>
      </section>

      <section aria-labelledby="screen-heading">
        <h2
          id="screen-heading"
          className="mb-1 font-display text-lg font-medium tracking-[-0.02em]"
        >
          Screen walkthrough
        </h2>
        <p className="mb-4 text-sm text-muted">
          Do the task once while sharing one window, and talk through what you&apos;re doing. The AI
          watches the captured frames, describes your method step by step, and{" "}
          {hasRules
            ? "proposes rule changes for you to review"
            : "adds it to your interview answers"}
          .
        </p>
        <Card className="p-5">
          <ActionForm
            action={screenWalkthroughAction}
            label="Learn from this walkthrough"
            pendingLabel="Watching your walkthrough…"
            className="space-y-4"
          >
            <input type="hidden" name="slug" value={skill.slug} />
            <ScreenWalkthrough />
          </ActionForm>
        </Card>
      </section>
    </div>
  );
}
