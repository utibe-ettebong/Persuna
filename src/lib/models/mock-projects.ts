/**
 * Offline stand-ins for Persuna's project checks (plan, fit, delivery check,
 * dispute, wrap-up). Deterministic, reading the same prompts the real models
 * get, so the whole project flow works without keys.
 */

const tagged = (text: string, tag: string) =>
  new RegExp(`<${tag}>\\n?([\\s\\S]*?)\\n?</${tag}>`).exec(text)?.[1].trim() ?? "";

const asSentence = (s: string) => {
  const t = s.trim();
  if (!t) return t;
  const capped = t[0].toUpperCase() + t.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
};

const sentencesOf = (text: string) =>
  text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter((s) => s.length > 3);

/** Planning a brief: its sentences become milestones and criteria, in equal shares. */
export function mockProjectPlan(user: string) {
  const brief = tagged(user, "project_brief");
  const sentences = sentencesOf(brief);
  const groups = Math.max(1, Math.min(3, Math.ceil(sentences.length / 2)));
  const per = Math.ceil(sentences.length / groups) || 1;
  const milestones = Array.from({ length: groups }, (_, g) => {
    const part = sentences.slice(g * per, g * per + per);
    const first = part[0] ?? "Deliver the work described in the brief";
    return {
      title: `Part ${g + 1}: ${first
        .split(/\s+/)
        .slice(0, 6)
        .join(" ")
        .replace(/[.!?,;:]$/, "")}`,
      criteria: (part.length ? part : [first]).slice(0, 3).map((s) => `Delivers: ${asSentence(s)}`),
      share: 1,
    };
  });
  const flags: { kind: string; message: string }[] = [];
  if (brief.length < 120) {
    flags.push({
      kind: "vague",
      message: "The brief is short: say what the finished work must include so it can be checked.",
    });
  }
  if (/\b(unlimited|free|asap)\b/i.test(brief)) {
    flags.push({
      kind: "unfair_terms",
      message: "Words like 'unlimited', 'free' or 'ASAP' read as one-sided; set clear limits.",
    });
  }
  return {
    scope: `Mock plan. ${sentences.slice(0, 3).join(" ") || "The work described in the brief."}`,
    criteria: sentences.slice(0, 3).map((s) => `Covers: ${asSentence(s)}`),
    milestones,
    flags,
  };
}

/** A fit report: verified skills and the price decide the recommendation. */
export function mockProposalFit(user: string) {
  const priceNote = /Proposed price: [^(]*\(([^)]*)\)/.exec(user)?.[1] ?? "";
  const hasSkills = !/Seller's verified skills: none listed/.test(user);
  const over = /over budget/.test(priceNote);
  return {
    summary: `Mock fit report: the price ${priceNote || "is unknown"}${hasSkills ? " and the seller has verified skills" : ""}.`,
    strengths: hasSkills ? ["Has skills verified on held-back examples."] : [],
    risks: [
      ...(over ? ["The price is over the budget."] : []),
      ...(hasSkills ? [] : ["No verified skills to judge the work by."]),
    ],
    recommendation: hasSkills && !over ? "strong" : !hasSkills && over ? "weak" : "possible",
  };
}

/** Checking a delivery: a criterion is met when most of its key words appear in it. */
export function mockMilestoneCheck(user: string) {
  const criteria = tagged(user, "milestone_criteria")
    .split("\n")
    .map((l) => l.replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean);
  const delivery = tagged(user, "milestone_delivery").toLowerCase();
  const results = (criteria.length ? criteria : ["The delivery"]).map((criterion) => {
    const words = (criterion.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).filter(
      (w) => w !== "delivers" && w !== "covers",
    );
    const found = words.filter((w) => delivery.includes(w)).length;
    const verdict =
      delivery.length < 40
        ? "unclear"
        : words.length && found / words.length >= 0.5
          ? "met"
          : "not_met";
    return {
      criterion,
      verdict,
      reason:
        verdict === "unclear"
          ? "The delivery is too short to tell."
          : `The delivery mentions ${found} of ${words.length} key words of this criterion.`,
    };
  });
  const met = results.filter((r) => r.verdict === "met").length;
  return {
    results,
    summary: `Mock check: ${met} of ${results.length} criteria met.`,
    fairness: {
      poster: "Ask only for what the criteria say; anything new is a new milestone.",
      seller: "Point to where each unmet criterion is covered, or cover it in the next round.",
    },
  };
}

export function mockDispute(user: string) {
  const raisedBy = /Raised by the (poster|seller)/.exec(user)?.[1] ?? "poster";
  return {
    assessment: `Mock assessment of a dispute raised by the ${raisedBy}, based on the milestones' checks.`,
    posterView: "The poster can expect every acceptance criterion to be met.",
    sellerView: "The seller should be paid for criteria the checks found met.",
    suggestion: "Pay for milestones whose criteria were met and give one more round on the rest.",
  };
}

export function mockWrapup(user: string) {
  const milestones = tagged(user, "project_wrapup").split("\n").length - 1;
  return {
    summary: `Mock wrap-up: ${milestones} milestone(s) delivered and paid.`,
    wentWell: ["Each milestone had criteria both sides could check."],
    toImprove: ["Agree on examples of the finished work at the start."],
  };
}
