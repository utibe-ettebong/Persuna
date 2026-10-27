"use client";

import { useState } from "react";
import { Markdown } from "@/components/markdown";

const RAW = `outreach planning call
ppl: Tunde (chair), Ifeoma, Musa
- tunde started 2pm
- ifeoma: venue confirmed for the 14th, cap 200. still need chairs
- musa can borrow chairs from the hall, will ask this wk
- decided to livestream, only if a volunteer is found by the 7th
- musa's car is in the shop (not relevant)
- ended 2:45`;

const DRAFT = `# Minutes: Outreach Planning

**Chair:** Tunde
**Present:** Tunde, Ifeoma, Musa

## Community event
Ifeoma confirmed the venue for the 14th, capacity 200.

**Decision:** Livestream the event if a volunteer is found by the 7th.

| Owner | Action | Due |
| --- | --- | --- |
| Musa | Borrow chairs from the hall | This week |
| Ifeoma | Find a livestream volunteer | 7th |`;

const TABS = [
  { key: "raw", label: "Your raw notes" },
  { key: "draft", label: "Agent draft" },
  { key: "learn", label: "What it learned" },
] as const;

const RULES = [
  ["structure", "Open with a header block: Chair, Present, Apologies."],
  ["cut", "Leave out asides that led to no decision or action."],
  ["formatting", "Action items go in a table: Owner | Action | Due."],
  ["naming", "Times in the 24-hour clock; refer to the chair as “the Chair”."],
] as const;

/** The hero's product card: raw input, the agent's draft in your format, and the rules behind it. */
export function HeroDemo() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("draft");
  return (
    <div className="rounded-xl border border-white/30 bg-white/95 p-2 text-[#1d161d] shadow-[0_30px_80px_-30px_rgba(20,6,30,0.6)]">
      <div className="rounded-lg border border-[#e4dfe4] bg-white">
        <div
          role="tablist"
          aria-label="Demo"
          className="flex flex-wrap gap-1 border-b border-[#eeecee] p-2"
        >
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              type="button"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`label-mono rounded-md px-3 py-1.5 transition-colors ${
                tab === t.key ? "bg-[#f1e6f8] text-[#6a2f8d]" : "text-[#5e555e] hover:bg-[#f8f6f8]"
              }`}
            >
              {t.label}
            </button>
          ))}
          <span className="label-mono ml-auto self-center rounded-sm border border-[#1f7a4d]/40 px-2 py-1 text-[#1f7a4d]">
            Replication 86
          </span>
        </div>
        <div role="tabpanel" className="h-[19rem] overflow-auto p-5 text-left">
          {tab === "raw" && (
            <pre className="whitespace-pre-wrap font-mono text-[0.8rem] leading-relaxed text-[#5e555e]">
              {RAW}
            </pre>
          )}
          {tab === "draft" && (
            <div className="[&_td]:border-[#eeecee] [&_th]:border-[#e4dfe4]">
              <Markdown text={DRAFT} />
            </div>
          )}
          {tab === "learn" && (
            <ul className="space-y-3 text-sm">
              {RULES.map(([cat, text], i) => (
                <li key={text} className="flex gap-3">
                  <span className="label-mono w-8 shrink-0 text-[#a89ea8]">R{i + 1}</span>
                  <span>
                    <span className="label-mono mr-2 text-[#6a2f8d]">{cat}</span>
                    {text}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-[#eeecee] bg-[#f8f6f8] px-4 py-2.5 text-xs text-[#5e555e]">
          <span>Learned from 10 of your before-and-after examples</span>
          <span className="label-mono text-[#6a2f8d]">Awaiting your approval</span>
        </div>
      </div>
    </div>
  );
}
