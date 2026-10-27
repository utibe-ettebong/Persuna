"use client";

import { useState } from "react";
import { saveRulesAction } from "@/app/actions/skills";
import { RULE_CATEGORIES, type Rule, type SkillSheet } from "@/lib/skill/types";
import { ActionForm } from "./action-form";
import { buttonClass, Field, inputClass } from "./ui";

/** Edits a copy of the working sheet; saving creates a new version. */
export function RuleEditor({ slug, sheet }: { slug: string; sheet: SkillSheet }) {
  const [summary, setSummary] = useState(sheet.summary);
  const [rules, setRules] = useState<Rule[]>(sheet.rules);
  const [template, setTemplate] = useState(sheet.template);

  const update = (id: string, patch: Partial<Rule>) =>
    setRules((all) => all.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const remove = (id: string) => setRules((all) => all.filter((r) => r.id !== id));
  const add = () =>
    setRules((all) => {
      const next = Math.max(0, ...all.map((r) => Number(r.id.slice(1)))) + 1;
      return [...all, { id: `R${next}`, category: "content", text: "" }];
    });

  const draft: SkillSheet = {
    summary: summary.trim(),
    rules: rules.map((r) => ({ ...r, text: r.text.trim() })).filter((r) => r.text),
    template,
  };

  return (
    <ActionForm
      action={saveRulesAction}
      label="Save as new version"
      pendingLabel="Saving…"
      className="space-y-6"
    >
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="sheet" value={JSON.stringify(draft)} />

      <Field label="Summary">
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={3}
          className={inputClass}
        />
      </Field>

      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-medium">Rules</legend>
        {rules.map((rule) => (
          <div
            key={rule.id}
            className="grid gap-2 sm:grid-cols-[3rem_10rem_1fr_auto] sm:items-start"
          >
            <span className="pt-3 font-mono text-xs text-muted">{rule.id}</span>
            <select
              aria-label={`Category for ${rule.id}`}
              value={rule.category}
              onChange={(e) => update(rule.id, { category: e.target.value as Rule["category"] })}
              className={inputClass}
            >
              {RULE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <textarea
              aria-label={`Text for ${rule.id}`}
              value={rule.text}
              onChange={(e) => update(rule.id, { text: e.target.value })}
              rows={2}
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => remove(rule.id)}
              className={`${buttonClass("danger")} mt-1`}
            >
              Remove
            </button>
          </div>
        ))}
        <button type="button" onClick={add} className={buttonClass("secondary")}>
          Add rule
        </button>
      </fieldset>

      <Field label="Output template">
        <textarea
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          rows={12}
          className={`${inputClass} font-mono text-xs`}
        />
      </Field>
    </ActionForm>
  );
}
