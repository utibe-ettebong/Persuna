"use client";

import { useState } from "react";
import { openTrialAction } from "@/app/actions/jobs";
import { ActionForm } from "@/components/action-form";
import { buttonClass, Card, Field, inputClass } from "@/components/ui";

export interface TryItVersion {
  id: string;
  version: number;
  source: string;
  isCurrent: boolean;
  isPublished: boolean;
}

/**
 * Runs a trial of one version: pick the version, write or pick an input, and
 * the trial drafts (and, for tool skills, works in your own apps once you
 * link them). Trials never count toward trust, earnings, or stats.
 */
export function TryItForm({
  skillId,
  versions,
  samples,
}: {
  skillId: string;
  versions: TryItVersion[];
  samples: string[];
}) {
  const [input, setInput] = useState("");
  const current = versions.find((v) => v.isCurrent) ?? versions[0];
  return (
    <Card className="space-y-4 p-5">
      <ActionForm action={openTrialAction} label="Run trial" pendingLabel="Running…">
        <input type="hidden" name="skillId" value={skillId} />
        <Field label="Version">
          <select name="versionId" defaultValue={current?.id} className={inputClass}>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.version} · {v.source}
                {v.isPublished ? " (published)" : ""}
                {v.isCurrent && !v.isPublished ? " (working)" : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Input">
          <textarea
            name="inputText"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={6}
            className={`${inputClass} font-mono text-xs`}
            placeholder="Paste something for this version to work on…"
          />
        </Field>
        {samples.length > 0 && (
          <div>
            <p className="mb-2 text-xs text-muted">Or start from a training example:</p>
            <div className="flex flex-wrap gap-2">
              {samples.map((sample, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setInput(sample)}
                  className={buttonClass("secondary")}
                  title={sample}
                >
                  {sample.length > 60 ? `${sample.slice(0, 60)}…` : sample}
                </button>
              ))}
            </div>
          </div>
        )}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="dryRun" value="on" defaultChecked className="mt-1" />
          <span>
            Dry run: each tool call asks first, even reads.{" "}
            <span className="text-muted">Off means reads run freely and only writes ask.</span>
          </span>
        </label>
      </ActionForm>
    </Card>
  );
}
