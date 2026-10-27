"use client";

import Link from "next/link";
import { useState } from "react";
import { buttonClass } from "@/components/ui";

const STEPS = [
  {
    key: "capture",
    label: "Capture",
    eyebrow: "Examples, interview, voice",
    title: "Show it how you work, not how work is usually done",
    body: "Upload 10–15 before-and-after pairs, answer a short interview, or talk through your method out loud. Names, numbers and addresses are found and replaced before anything is saved, and you confirm every pair.",
    cta: "Add your first examples",
    panel: (
      <div className="space-y-2 font-mono text-[0.78rem]">
        <p className="text-white/60">present: Bisi A. (chair), Emeka, Fola</p>
        <p>
          present: <Mask>PERSON 1</Mask> (chair), <Mask>PERSON 2</Mask>, <Mask>PERSON 3</Mask>
        </p>
        <p className="pt-2 text-white/60">call 0803 555 1234 about the Zenith Bank fees</p>
        <p>
          call <Mask>PHONE</Mask> about the <Mask>ORG 1</Mask> fees
        </p>
      </div>
    ),
  },
  {
    key: "test",
    label: "Test",
    eyebrow: "Replication score",
    title: "Measured against work you already finished",
    body: "The agent writes a plain-language skill sheet, then drafts the examples you held back. Each draft is scored against your real version on structure, content, cuts, tone and naming, so you know how close it is before anyone relies on it.",
    cta: "See a test run",
    panel: (
      <div className="space-y-3">
        {[
          ["structure", 9],
          ["content", 8.5],
          ["cuts", 8],
          ["tone", 9],
          ["naming", 7.5],
        ].map(([k, v]) => (
          <div key={k} className="flex items-center gap-3 font-mono text-[0.78rem]">
            <span className="w-20 uppercase tracking-[0.06em] text-white/70">{k}</span>
            <span className="h-2 flex-1 rounded-sm bg-white/15">
              <span
                className="block h-2 rounded-sm bg-white"
                style={{ width: `${Number(v) * 10}%` }}
              />
            </span>
            <span className="w-8 text-right">{v}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    key: "learn",
    label: "Learn",
    eyebrow: "Corrections become rules",
    title: "Every edit you make teaches it, if you say so",
    body: "Fix a draft and the agent proposes the smallest rule change that would have produced your version. You accept or reject it; accepting creates a new version and re-runs the tests, so you watch the score move.",
    cta: "Open the studio",
    panel: (
      <div className="space-y-2 font-mono text-[0.78rem]">
        <p className="text-white/60">Your reason: “We never abbreviate the organisation’s name”</p>
        <p className="rounded-sm border border-white/25 p-2">
          <span className="text-[#9fe3c4]">+ add R9 · naming</span>
          <br />
          Write organisation names in full on every mention.
        </p>
        <p className="pt-1">
          v3 <span className="text-white/60">74.6</span> → v4{" "}
          <span className="text-[#9fe3c4]">81.2</span>
        </p>
      </div>
    ),
  },
  {
    key: "publish",
    label: "Publish",
    eyebrow: "Versioned, reversible",
    title: "Only tested versions do real work",
    body: "Jobs always use the version you published. A version that scores lower than the live one is blocked until you've reviewed it, and any earlier version is one click away.",
    cta: "Start a skill",
    panel: (
      <ul className="space-y-2 font-mono text-[0.78rem]">
        <li className="flex justify-between border-b border-white/15 pb-2">
          <span>v4 correction</span>
          <span className="text-[#9fe3c4]">81.2 · published</span>
        </li>
        <li className="flex justify-between border-b border-white/15 pb-2">
          <span>v3 edit</span>
          <span className="text-white/70">74.6</span>
        </li>
        <li className="flex justify-between">
          <span>v2 extract</span>
          <span className="text-white/70">70.7</span>
        </li>
      </ul>
    ),
  },
];

function Mask({ children }: { children: React.ReactNode }) {
  return <span className="rounded-sm bg-white/90 px-1 text-[#2e6b6a]">[{children}]</span>;
}

/** "How it works": four tabs, each a short explanation beside a small product panel. */
export function WorkflowTabs() {
  const [active, setActive] = useState(STEPS[0].key);
  const step = STEPS.find((s) => s.key === active)!;
  return (
    <div>
      <div
        role="tablist"
        aria-label="How it works"
        className="flex overflow-x-auto border-y border-line"
      >
        {STEPS.map((s, i) => (
          <button
            key={s.key}
            role="tab"
            type="button"
            aria-selected={active === s.key}
            onClick={() => setActive(s.key)}
            className={`label-mono flex items-center gap-2 whitespace-nowrap border-r border-line px-5 py-3.5 transition-colors ${
              active === s.key
                ? "bg-card text-teal shadow-[inset_0_-2px_0_var(--teal)]"
                : "text-muted hover:bg-card hover:text-foreground"
            }`}
          >
            <span className="text-faint">0{i + 1}</span> {s.label}
          </button>
        ))}
        <div aria-hidden className="hatch min-w-6 flex-1" />
      </div>
      <div role="tabpanel" className="grid lg:grid-cols-2">
        <div className="lattice relative flex min-h-80 items-center justify-center bg-teal p-8 text-white sm:p-12">
          <div className="w-full max-w-md rounded-md border border-white/20 bg-black/15 p-5 backdrop-blur-sm">
            {step.panel}
          </div>
        </div>
        <div className="flex flex-col justify-center gap-5 border-t border-line p-8 sm:p-12 lg:border-l lg:border-t-0">
          <span className="label-mono w-fit rounded-sm bg-mint px-2 py-1 text-teal">
            {step.eyebrow}
          </span>
          <h3 className="font-display text-3xl font-medium leading-tight tracking-[-0.03em] sm:text-4xl">
            {step.title}
          </h3>
          <p className="max-w-lg leading-relaxed text-muted">{step.body}</p>
          <Link href="/skills" className={`${buttonClass("primary", "md")} w-fit`}>
            {step.cta}
          </Link>
        </div>
      </div>
    </div>
  );
}
