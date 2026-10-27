import { z } from "zod";

export const jobFlag = z.object({
  kind: z.enum(["missing_info", "invented_detail", "rule_conflict", "unusual_input", "uncertain"]),
  message: z.string().min(1),
});

export type JobFlag = z.infer<typeof jobFlag>;

export const selfCheckResult = z.object({
  flags: z.array(jobFlag),
});

/** Numbers, times and amounts, including suffixes like "50k" or "2pm". */
const NUMBER = /\b\d[\d,.:]*[a-z]*\b/gi;

/**
 * Checks that need no model. Numbers and times in the draft that never appear
 * in the input are the most common way a draft invents facts; inputs far
 * shorter or longer than the training examples are the most common unusual input.
 */
export function deterministicFlags(
  input: string,
  draft: string,
  trainingInputLengths: number[],
): JobFlag[] {
  const flags: JobFlag[] = [];

  const inputNumbers = new Set(normaliseNumbers(input));
  const invented = [...new Set(normaliseNumbers(draft))].filter((n) => !inputNumbers.has(n));
  if (invented.length > 0) {
    flags.push({
      kind: "invented_detail",
      message: `The draft has numbers or times not in the input: ${invented.slice(0, 5).join(", ")}.`,
    });
  }

  if (trainingInputLengths.length >= 2) {
    const sorted = [...trainingInputLengths].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (input.length < median / 4) {
      flags.push({
        kind: "unusual_input",
        message:
          "This input is much shorter than the training examples. Information may be missing.",
      });
    } else if (input.length > median * 4) {
      flags.push({
        kind: "unusual_input",
        message: "This input is much longer than the training examples. Check nothing was dropped.",
      });
    }
  }

  return flags;
}

/** Numbers as they would be compared: "2:45", "14:45" and "1,000" are kept as written, minus trailing dots. */
function normaliseNumbers(text: string): string[] {
  return (text.match(NUMBER) ?? [])
    .map((n) => n.toLowerCase().replace(/[.,:]+$/, ""))
    .filter((n) => n.length > 0 && !/^[0-9]$/.test(n));
}

/** Merges model and deterministic flags, dropping exact duplicates. */
export function mergeFlags(...lists: JobFlag[][]): JobFlag[] {
  const seen = new Set<string>();
  return lists.flat().filter((f) => {
    const key = `${f.kind}:${f.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
