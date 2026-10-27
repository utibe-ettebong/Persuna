import { diffWords } from "diff";

/**
 * Shows the owner's version with the agent's differences marked: struck-through
 * text is what the agent wrote that the owner didn't, underlined text is what
 * the owner wrote that the agent missed.
 */
export function WordDiff({ draft, reference }: { draft: string; reference: string }) {
  const parts = diffWords(draft, reference);
  return (
    <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">
      {parts.map((part, i) =>
        part.added ? (
          <ins key={i} className="bg-good/15 text-good underline decoration-1">
            {part.value}
          </ins>
        ) : part.removed ? (
          <del key={i} className="bg-danger/15 text-danger">
            {part.value}
          </del>
        ) : (
          <span key={i}>{part.value}</span>
        ),
      )}
    </pre>
  );
}
