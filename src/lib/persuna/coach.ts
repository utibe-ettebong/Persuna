/**
 * Coaching on a skill: where it stands and the one or two things that would
 * move it forward, ending at a marketplace listing. Pure, so it is tested
 * without a database. Example estimates are rough guidance, said as such.
 */
export interface SkillStats {
  name: string;
  slug: string;
  answered: number;
  totalQuestions: number;
  trainPairs: number;
  testPairs: number;
  hasRules: boolean;
  published: boolean;
  /** Latest test score of the published version (or of the working version when unpublished). */
  score: number | null;
  minScore: number;
  listed: boolean;
}

export interface Coaching {
  stage: "start" | "examples" | "rules" | "test" | "improve" | "publish" | "list" | "listed";
  /** One sentence Persuna says. */
  message: string;
  /** Where to go to do it. */
  href: string;
  action: string;
}

/** A rough rule of thumb: each extra training example adds about 4 points, at most 5 examples. */
export function examplesToReach(score: number, target: number): number {
  return Math.min(5, Math.max(1, Math.ceil((target - score) / 4)));
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function coachSkill(s: SkillStats): Coaching {
  const base = `/skills/${s.slug}`;
  if (s.trainPairs === 0 && s.answered === 0) {
    return {
      stage: "start",
      message: `${s.name} is empty so far. Say "teach me" and I'll ask how you do it, or add a before-and-after example.`,
      href: `${base}/interview`,
      action: "Start teaching",
    };
  }
  if (s.trainPairs < 2 || s.testPairs < 1) {
    const train = Math.max(0, 2 - s.trainPairs);
    const test = Math.max(0, 1 - s.testPairs);
    const need = [train && plural(train, "training example"), test && plural(test, "test example")]
      .filter(Boolean)
      .join(" and ");
    return {
      stage: "examples",
      message: `${s.name} needs ${need} before I can learn its rules and score it.`,
      href: `${base}/examples`,
      action: "Add examples",
    };
  }
  if (!s.hasRules) {
    return {
      stage: "rules",
      message: `${s.name} has enough examples. Extract its rules next, and I'll start drafting your way.`,
      href: base,
      action: "Extract rules",
    };
  }
  if (s.score === null) {
    return {
      stage: "test",
      message: `${s.name} has rules but no score yet. Run the tests to see how close my drafts are to yours.`,
      href: base,
      action: "Run tests",
    };
  }
  const score = Math.round(s.score);
  if (score < s.minScore) {
    const n = examplesToReach(score, s.minScore);
    return {
      stage: "improve",
      message: `Your ${s.name} skill scores ${score}. About ${plural(n, "more training example")} (or correcting a few test drafts) should get it to ${s.minScore} so you can list it. That's a rough guide, not a promise.`,
      href: `${base}/examples`,
      action: "Add examples",
    };
  }
  if (!s.published) {
    return {
      stage: "publish",
      message: `${s.name} scores ${score}, above the ${s.minScore} needed. Publish it so I can use it for real work.`,
      href: base,
      action: "Publish",
    };
  }
  if (!s.listed) {
    return {
      stage: "list",
      message: `${s.name} scores ${score} and is published. You can list it in the marketplace now and people can rent it.`,
      href: `${base}/listing`,
      action: "Create a listing",
    };
  }
  return {
    stage: "listed",
    message: `${s.name} scores ${score} and is listed. Keep approving jobs to raise its trust level.`,
    href: `${base}/trust`,
    action: "See trust",
  };
}

/**
 * Whether the next example should be held back for testing: the third one
 * (once there are two to learn from), then about one in four.
 */
export function suggestTestSplit(train: number, test: number): boolean {
  if (train < 2) return false;
  if (test === 0) return true;
  return test < Math.floor((train + test + 1) / 4);
}
