import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = {
  title: "Privacy — what Persuna sees, keeps, and sends",
  description: "In plain words: what each mode sees, what's kept, for how long, and where it goes.",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="font-display text-xl font-medium tracking-[-0.02em]">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-muted">{children}</div>
    </section>
  );
}

/**
 * The privacy page, in plain words: what each mode sees, what's kept, for how
 * long, where it goes. Every claim here names code that enforces it.
 */
export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-10">
      <PageHeader
        eyebrow="Privacy"
        title="What Persuna sees, keeps, and sends"
        description="In plain words. If a sentence here ever stops matching the product, that's a bug — tell us."
      />

      <Section title="Your screen">
        <p>
          <strong className="text-foreground">Talk mode sends nothing.</strong> A spoken turn
          carries no screen at all, and the server refuses one if it arrives.
        </p>
        <p>
          <strong className="text-foreground">Look mode sends one look</strong>, only when you
          circle something and ask about it, and only the circled part.
        </p>
        <p>
          <strong className="text-foreground">Work mode follows along</strong> while it&apos;s on: a
          list of what&apos;s on screen (app names, window titles, buttons and labels) and
          screenshots when words aren&apos;t enough. It turns itself off after 30 quiet minutes, and
          the island and menu bar always show when the screen is being read.
        </p>
        <p>
          Apps you list as excluded — banking, personal messages — are never read, even in Work
          mode: a look while one is in front comes back empty, and if Persuna can&apos;t tell which
          app is in front, it doesn&apos;t look. A window behind the front app can still appear in a
          screenshot, so close it first. Reads are written to the audit log with the mode that
          allowed them, and the count of reads outside Work or Look must be zero.
        </p>
        <p>
          In Learn mode, Persuna records accessibility events — which app, which window, what was
          clicked or typed into — but never the values: no passwords, no text you typed. Episode
          screenshots are deleted once the learning pass has run.
        </p>
      </Section>

      <Section title="Your voice">
        <p>
          With the voice on, your microphone streams to ElevenLabs as you talk, so your words are
          known live; no recording is kept for that. Without it, a recording goes to Meta&apos;s
          listening model, which hears and answers, or is transcribed first.
        </p>
        <p>
          Spoken replies are made by ElevenLabs or by our own voice model, and chosen per role on
          the Models page. Recordings are used for the turn and not kept afterwards.
        </p>
      </Section>

      <Section title="Your words and work">
        <p>
          What you type and say to Persuna goes to the model serving that turn — Meta&apos;s models
          for most roles — and to no one else. Which model serves each role is listed on the Models
          &amp; keys page.
        </p>
        <p>
          Kept on Persuna&apos;s servers: your profile and memory, messages, notes and reminders,
          your skills (rules, examples, interview answers, observed steps), episodes and their
          events, jobs and listings, projects and proposals, portfolio, team memberships, and counts
          of model use and turn timings. Connection tokens for Gmail, Calendar, Notion and MCP
          servers are sealed and never leave the server.
        </p>
        <p>
          Jobs and projects expire 30 days after they close. Everything else stays until you delete
          it: your profile&apos;s Your data section downloads it all as one file, or deletes it all
          as one act — which signs you out everywhere. Sold listings and payments keep their records
          without your words or name, and the audit trail keeps what happened, as the
          platform&apos;s own record.
        </p>
      </Section>

      <Section title="Money">
        <p>
          Payments go through Paystack&apos;s checkout: your card details go to Paystack, never to
          Persuna. Persuna keeps amounts, references and who was paid, so disputes can be settled
          fairly.
        </p>
      </Section>

      <Section title="Teams and the marketplace">
        <p>
          Skills you share with your team are visible to teammates but stay yours. Skills attached
          to a team role are company know-how: confidential to the company, never listed, never
          named in public. On the marketplace, listings are public; renters appear by first name
          only.
        </p>
      </Section>

      <p className="text-sm text-muted">
        Signed in?{" "}
        <Link href="/profile" className="text-accent underline">
          Your data lives on your profile
        </Link>
        .
      </p>
    </div>
  );
}
