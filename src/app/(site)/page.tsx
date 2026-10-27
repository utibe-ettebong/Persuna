import type { Metadata } from "next";
import Link from "next/link";
import { Frame, HatchStrip, SectionLabel } from "@/components/brand";
import { HeroDemo } from "@/components/landing/hero-demo";
import { WorkflowTabs } from "@/components/landing/workflow-tabs";
import { buttonClass } from "@/components/ui";

export const metadata: Metadata = {
  title: { absolute: "PERSUNA: your method, multiplied" },
};

const PRINCIPLES = [
  [
    "Rent the method",
    "never the persona or the material. Renters get results, not your rules or clients.",
  ],
  [
    "The human approves",
    "Nothing goes out without your sign-off until you choose to grant more autonomy.",
  ],
  ["The skill stays here", "Skills run only on the platform. They're never downloaded or copied."],
];

const LEVELS = [
  {
    level: "0",
    title: "Review everything",
    body: "Every draft waits for you. Where every skill, and every new version, starts.",
  },
  {
    level: "1",
    title: "Auto-approve proven work",
    body: "After 20 reviewed jobs with 90% approved unchanged or lightly edited, clean drafts go straight out.",
  },
  {
    level: "2",
    title: "Spot-check",
    body: "After 50 clean jobs at level 1, you review a random 1 in 5, plus anything flagged.",
  },
];

const SAFEGUARDS = [
  {
    title: "Method, never material",
    body: "Skills hold rules, style and approved anonymised examples. Client jobs live apart and are deleted after 30 days.",
  },
  {
    title: "Redaction before saving",
    body: "Names, organisations, places, phone and account numbers become consistent placeholders, and you confirm each pair.",
  },
  {
    title: "A full audit trail",
    body: "Every rule change, approval, publish, trust change and payment is recorded with who and when.",
  },
  {
    title: "Escrow through Paystack",
    body: "Renters pay up front; the money is released only when they accept the result, and refunded if you decline.",
  },
];

const FAQ = [
  [
    "Who is PERSUNA for?",
    "Freelancers, independent professionals and teams whose work follows a method they own: proofreading, minutes, reports, reconciliations. Anyone can train skills for their own work; listing one for rent needs proof you own the method.",
  ],
  [
    "How does it learn my way of working?",
    "From before-and-after examples of your real work, a short interview, and optionally a voice walkthrough. It writes down your method as plain-language rules you can read and edit, then tests itself against examples you held back.",
  ],
  [
    "Does it watch my screen?",
    "No. Skills are captured deliberately, from material you choose to share. A recorded walkthrough of one task is on the roadmap, always opt-in and reviewed by you.",
  ],
  [
    "What do renters see?",
    "Only the finished, approved result for their task, labelled AI-produced and owner-approved. Never your rules, your examples, or other clients' work.",
  ],
  [
    "I'm an employee. Can I list a skill?",
    "Yes, with your employer's approval. They get a private link, approve the listing and set their share of the earnings.",
  ],
  [
    "Which AI models does it use?",
    "Meta's Muse models: Muse Spark to learn rules, Muse Spark Open to draft and score, Muse Voice Transcribe for voice. The runtime is model-agnostic, so providers can change without touching a skill.",
  ],
];

export default function LandingPage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <Frame className="relative">
          <div aria-hidden className="halftone absolute inset-0" />
          <div className="relative px-4 pb-24 pt-20 text-center sm:px-8 sm:pt-28">
            <Link
              href="/skills"
              className="reveal label-mono inline-flex items-center gap-2 rounded-sm border border-accent/60 bg-accent-soft/70 px-3 py-1.5 text-accent hover:bg-accent-soft"
            >
              New: teach a skill by voice <span aria-hidden>→</span>
            </Link>
            <h1 className="reveal mx-auto mt-7 max-w-4xl font-display text-[clamp(2.6rem,7vw,5.25rem)] font-medium leading-[0.98] tracking-[-0.045em] [animation-delay:60ms]">
              Your method, multiplied.
            </h1>
            <p className="reveal mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted [animation-delay:120ms] sm:text-xl">
              PERSUNA learns how <strong className="font-medium text-foreground">you</strong> do
              your work from your own before-and-after examples, drafts it your way, and waits for
              your sign-off. Then rent your method to others and get paid per task.
            </p>
            <div className="reveal mt-9 flex flex-wrap justify-center gap-3 [animation-delay:180ms]">
              <Link href="/sign-up" className={buttonClass("primary", "md")}>
                Try it free
              </Link>
              <Link href="/market" className={buttonClass("secondary", "md")}>
                Browse the marketplace
              </Link>
            </div>
          </div>
        </Frame>
        <div className="border-y border-line bg-card">
          <Frame className="grid sm:grid-cols-3">
            {PRINCIPLES.map(([title, body], i) => (
              <div
                key={title}
                className={`px-6 py-6 ${i > 0 ? "border-t border-line sm:border-l sm:border-t-0" : ""}`}
              >
                <p className="label-mono text-foreground">{title}</p>
                <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
              </div>
            ))}
          </Frame>
        </div>
      </section>

      {/* Demo band */}
      <section aria-label="Demo" className="bg-accent">
        <Frame className="border-white/15 px-4 py-16 sm:px-8 sm:py-24">
          <p className="label-mono mx-auto w-fit bg-black/25 px-3 py-1.5 text-white">
            One meeting, start to finish
          </p>
          <div className="mx-auto mt-8 max-w-3xl">
            <HeroDemo />
          </div>
        </Frame>
      </section>

      {/* How it works */}
      <section id="how" className="scroll-mt-16">
        <Frame>
          <div className="px-4 pb-10 pt-16 sm:px-8 sm:pt-20">
            <SectionLabel index="01">How it works</SectionLabel>
            <h2 className="mt-5 max-w-3xl font-display text-4xl font-medium leading-[1.02] tracking-[-0.035em] sm:text-5xl">
              From your examples to a skill that works like you
            </h2>
          </div>
          <WorkflowTabs />
        </Frame>
      </section>

      <HatchStrip className="h-10" />

      {/* Trust ladder */}
      <section id="trust" className="scroll-mt-16">
        <Frame>
          <div className="px-4 pb-12 pt-16 text-center sm:px-8 sm:pt-20">
            <SectionLabel index="02">The trust ladder</SectionLabel>
            <h2 className="mx-auto mt-5 max-w-3xl font-display text-4xl font-medium leading-[1.02] tracking-[-0.035em] sm:text-5xl">
              Autonomy you grant, one level at a time
            </h2>
            <p className="mx-auto mt-5 max-w-2xl leading-relaxed text-muted">
              Every skill starts by sending you everything. It earns independence from its own
              record, and you decide when to climb. Flagged or unusual jobs always come back to you.
            </p>
          </div>
          <div className="lattice bg-accent px-4 py-14 sm:px-10">
            <ol className="mx-auto grid max-w-5xl gap-4 md:grid-cols-3">
              {LEVELS.map((l) => (
                <li
                  key={l.level}
                  className="rounded-md border border-white/25 bg-white/95 p-6 text-[#1d161d]"
                >
                  <p className="label-mono text-[#6a2f8d]">Level {l.level}</p>
                  <p className="mt-3 font-display text-xl font-medium tracking-[-0.02em]">
                    {l.title}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-[#5e555e]">{l.body}</p>
                </li>
              ))}
            </ol>
            <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-white/80">
              A new version resets to level 0. So does a single renter complaint.
            </p>
          </div>
        </Frame>
      </section>

      {/* Renting */}
      <section id="rent" className="scroll-mt-16 border-t border-line">
        <Frame className="grid lg:grid-cols-2">
          <div className="px-4 py-16 sm:px-8 sm:py-20">
            <SectionLabel index="03">Rent a skill</SectionLabel>
            <h2 className="mt-5 font-display text-4xl font-medium leading-[1.02] tracking-[-0.035em] sm:text-5xl">
              Your method earns while someone else is the client
            </h2>
            <ul className="mt-8 space-y-4 text-[0.95rem] leading-relaxed text-muted">
              <li>
                <span className="label-mono mr-2 text-foreground">Price</span>
                You set it per task. Offer guaranteed personal review for an extra fee.
              </li>
              <li>
                <span className="label-mono mr-2 text-foreground">Gate</span>
                Listing needs a published version that scores well and a declaration that the method
                is yours. Employees list with their employer&apos;s approval and agreed split.
              </li>
              <li>
                <span className="label-mono mr-2 text-foreground">Escrow</span>
                Renters pay up front through Paystack; the money is released when they accept.
              </li>
            </ul>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/market" className={buttonClass("primary", "md")}>
                Browse skills
              </Link>
              <Link href="/skills" className={buttonClass("secondary", "md")}>
                List your own
              </Link>
            </div>
          </div>
          <div className="hatch flex items-center justify-center border-t border-line px-4 py-14 sm:px-10 lg:border-l lg:border-t-0">
            <div className="w-full max-w-sm rounded-md border border-line bg-card p-6 shadow-[0_20px_60px_-30px_rgba(29,22,29,0.35)]">
              <p className="label-mono text-muted">One rented task</p>
              <dl className="mt-4 space-y-2.5 text-sm">
                {[
                  ["Renter pays", "₦5,000", ""],
                  ["Platform fee (20%)", "−₦1,000", "text-muted"],
                  ["Employer share (if any)", "agreed %", "text-muted"],
                ].map(([k, v, c]) => (
                  <div key={k} className={`flex justify-between ${c}`}>
                    <dt>{k}</dt>
                    <dd className="tabular-nums">{v}</dd>
                  </div>
                ))}
                <div className="flex justify-between border-t border-line pt-3 font-medium">
                  <dt>You receive</dt>
                  <dd className="tabular-nums text-accent">₦4,000</dd>
                </div>
              </dl>
              <ol className="mt-6 flex items-center gap-2 text-[0.7rem]">
                {["Paid", "Drafted", "Approved", "Released"].map((s, i) => (
                  <li key={s} className="flex flex-1 flex-col gap-1.5">
                    <span className={`h-1 rounded-sm ${i < 3 ? "bg-accent" : "bg-line-strong"}`} />
                    <span className="label-mono text-muted">{s}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </Frame>
      </section>

      {/* Safeguards */}
      <section id="safeguards" className="scroll-mt-16 border-t border-line bg-card">
        <Frame>
          <div className="px-4 pb-10 pt-16 sm:px-8 sm:pt-20">
            <SectionLabel index="04">Safeguards</SectionLabel>
            <h2 className="mt-5 max-w-3xl font-display text-4xl font-medium leading-[1.02] tracking-[-0.035em] sm:text-5xl">
              Built so confidentiality doesn&apos;t depend on a prompt
            </h2>
          </div>
          <div className="grid gap-px border-t border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
            {SAFEGUARDS.map((s, i) => (
              <div key={s.title} className="bg-card p-6 sm:p-8">
                <p className="label-mono text-accent">0{i + 1}</p>
                <p className="mt-4 font-display text-xl font-medium tracking-[-0.02em]">
                  {s.title}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
              </div>
            ))}
          </div>
        </Frame>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-16 border-t border-line">
        <Frame className="grid lg:grid-cols-2">
          <div className="px-4 py-16 sm:px-8 sm:py-20">
            <SectionLabel index="05">FAQ</SectionLabel>
            <h2 className="mt-5 font-display text-4xl font-medium leading-[1.02] tracking-[-0.035em] sm:text-5xl">
              Your questions, answered
            </h2>
            <p className="mt-5 max-w-md leading-relaxed text-muted">
              Built for the Meta Global AI Developer Hackathon. Start with one task you do often,
              like turning meeting notes into minutes.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/skills" className={buttonClass("primary", "md")}>
                Open studio
              </Link>
            </div>
          </div>
          <div className="border-t border-line lg:border-l lg:border-t-0">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group border-b border-line last:border-b-0">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-6 text-[1.05rem] hover:bg-card sm:px-8 [&::-webkit-details-marker]:hidden">
                  {q}
                  <span
                    aria-hidden
                    className="text-2xl font-light text-faint transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="px-6 pb-6 leading-relaxed text-muted sm:px-8">{a}</p>
              </details>
            ))}
          </div>
        </Frame>
      </section>

      {/* Closing call to action */}
      <section className="plum-band">
        <div className="mx-auto max-w-6xl border-x border-white/10 px-4 py-24 text-center sm:px-8">
          <h2 className="mx-auto max-w-3xl font-display text-[clamp(2.4rem,6vw,4.25rem)] font-medium leading-[1.02] tracking-[-0.04em]">
            Do your best work at the scale of a team
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-white/70">
            Train one skill on ten examples. Approve its drafts. Watch the score climb.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link
              href="/sign-up"
              className="label-mono rounded-md bg-white px-5 py-3 text-[#1d161d] transition-colors hover:bg-white/90"
            >
              Try it free
            </Link>
            <Link
              href="/market"
              className="label-mono rounded-md border border-white/30 px-5 py-3 text-white transition-colors hover:border-white"
            >
              Browse the marketplace
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
