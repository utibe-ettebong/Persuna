"use client";

import { LOOKS, LOOK_IDS, lookOf, type LookId } from "@/lib/persona/looks";
import { PersonaOrb } from "./orb";

/** Choose how Persona looks: each option is a small live Persona in that colour. */
export function LookPicker({
  value,
  onChange,
  legend = "Look",
}: {
  value: string;
  onChange: (look: LookId) => void;
  legend?: string;
}) {
  const current = lookOf(value);
  return (
    <fieldset>
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="mt-2 flex flex-wrap gap-1">
        {LOOK_IDS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            aria-pressed={id === current}
            aria-label={`${LOOKS[id].label} look`}
            title={LOOKS[id].label}
            className={`grid place-items-center rounded-2xl p-1 transition-colors ${
              id === current ? "bg-accent-soft" : "hover:bg-subtle"
            }`}
          >
            <PersonaOrb look={id} size={40} animate={id === current} />
          </button>
        ))}
      </div>
    </fieldset>
  );
}
