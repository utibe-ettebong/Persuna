/**
 * Offline stand-ins for Persuna for teams (role playbooks, onboarding plans,
 * marking answers, answering a recruit's questions). Deterministic, reading
 * the same prompts the real models get, so the whole team flow works without keys.
 */

const tagged = (text: string, tag: string) =>
  new RegExp(`<${tag}>\\n?([\\s\\S]*?)\\n?</${tag}>`).exec(text)?.[1].trim() ?? "";

const NONE = /^\((none|no skills)/;

const STOP = new Set(
  "what when where which who how does do the and for with that this from have your you our are was were will would should could about into than then them they their there here just also only".split(
    " ",
  ),
);
const words = (s: string) =>
  (s.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).filter((w) => !STOP.has(w));

/** Rule lines of a rendered skill sheet ("- [R3] Start with …"), under their section title. */
function sheetRules(section: string) {
  const out: { heading: string; text: string }[] = [];
  let heading = "";
  for (const line of section.split("\n")) {
    const h = /^###\s+(.*)/.exec(line);
    if (h) heading = h[1].toLowerCase();
    const r = /^-\s*\[R\d+\]\s*(.+)/.exec(line);
    if (r) out.push({ heading, text: r[1].trim() });
  }
  return out;
}

const handbookLines = (handbook: string) =>
  NONE.test(handbook)
    ? []
    : handbook
        .split("\n")
        .map((l) => l.replace(/^[-*•#\d.)\s]+/, "").trim())
        .filter((l) => l.length > 3);

/** A playbook: one workflow per attached skill, its rules as steps, standards and mistakes. */
export function mockPlaybook(user: string) {
  const handbook = handbookLines(tagged(user, "company_handbook"));
  const skillsText = tagged(user, "role_playbook_skills");
  const role = /Role: "([^"]*)"/.exec(user)?.[1] ?? "the role";
  const sections = NONE.test(skillsText)
    ? []
    : skillsText.split(/^=== Skill: /m).filter((s) => s.trim());
  const tools = handbook.filter((l) =>
    /\b(tool|use|uses|using|figma|slack|notion|jira)\b/i.test(l),
  );
  const workflows = sections.slice(0, 8).map((section) => {
    const title = section.split("\n")[0].replace(/\s*===\s*$/, "");
    const when = /^Task:\s*(.+)$/m.exec(section)?.[1] ?? "";
    const rules = sheetRules(section);
    const structural = rules
      .filter((r) => /structure|what goes in|formatting/.test(r.heading))
      .map((r) => r.text);
    const steps = (structural.length ? structural : rules.map((r) => r.text)).slice(0, 10);
    return {
      title: title.trim().slice(0, 120) || "Day-to-day work",
      when: when.slice(0, 300),
      steps: steps.length ? steps : ["Follow the method in the skill's rules."],
      tools: tools.slice(0, 3),
      qualityBar: rules
        .filter((r) => /what goes in|tone|naming/.test(r.heading))
        .map((r) => r.text)
        .slice(0, 5),
      mistakes: rules
        .filter((r) => /cut/.test(r.heading))
        .map((r) => r.text)
        .slice(0, 5),
    };
  });
  return {
    summary: `Mock playbook for ${role}: ${workflows.length || 1} workflow(s) built from the team's skills and handbook.`,
    workflows: workflows.length
      ? workflows
      : [
          {
            title: "Day-to-day work",
            when: "",
            steps: handbook.length ? handbook.slice(0, 5) : ["Ask your manager how work comes in."],
            tools: tools.slice(0, 3),
            qualityBar: [],
            mistakes: [],
          },
        ],
    tools: tools.slice(0, 5),
    qualityBar: handbook.filter((l) => /\b(always|must|quality|value)\b/i.test(l)).slice(0, 4),
    mistakes: handbook.filter((l) => /\b(never|don't|avoid)\b/i.test(l)).slice(0, 4),
  };
}

/** A plan: a company module from the handbook, then one module per workflow in the playbook. */
export function mockOnboardingPlan(user: string) {
  const handbook = handbookLines(tagged(user, "company_handbook"));
  const playbook = tagged(user, "onboarding_playbook");
  const role = /Role: "([^"]*)"/.exec(user)?.[1] ?? "your role";
  const workflows = playbook
    .split(/^### Workflow: /m)
    .slice(1)
    .map((part) => {
      const [title, ...rest] = part.split("\n");
      const body = rest.join("\n");
      const steps = [...body.matchAll(/^\d+\.\s+(.+)$/gm)].map((m) => m[1]);
      return { title: title.trim(), body, steps };
    });
  const company = {
    kind: "company",
    title: "The company and how we work",
    lessons: [
      {
        title: "How we work",
        body: handbook.length
          ? handbook
              .slice(0, 8)
              .map((l) => `- ${l}`)
              .join("\n")
          : "Your team hasn't written its handbook yet. Ask your manager about values, tools and processes.",
      },
    ],
    practice: {
      task: "In a few sentences, describe how you'd apply the company's ways of working in your first week.",
      rubric: handbook.length ? handbook.slice(0, 2) : ["Mentions the team's ways of working."],
    },
    check: [
      {
        question: "What matters most in how this company works?",
        rubric: handbook.length ? handbook.slice(0, 2) : ["Names a way of working."],
      },
    ],
  };
  const modules = workflows.map((w) => ({
    kind: "workflow",
    title: w.title,
    lessons: [
      {
        title: `How ${w.title} runs`,
        body: w.body.trim() || "Follow the steps in the playbook.",
      },
    ],
    practice: {
      task: `Walk through how you'd do "${w.title}" from start to finish, step by step.`,
      rubric: (w.steps.length ? w.steps : [w.title]).slice(0, 4),
    },
    check: [
      {
        question: `What are the steps of "${w.title}", in order?`,
        rubric: (w.steps.length ? w.steps : [w.title]).slice(0, 3),
      },
      {
        question: `How do you know "${w.title}" is done well?`,
        rubric: [w.steps.at(-1) ?? w.title],
      },
    ],
  }));
  return {
    welcome: `Mock welcome: you're joining as ${role}. Work through each module at your own pace.`,
    modules: [company, ...modules],
  };
}

/** Marking: a rubric point is covered when half its key words appear in the answer. */
export function mockOnboardingGrade(user: string) {
  const items = tagged(user, "onboarding_answers")
    .split(/^### Item \d+\n/m)
    .slice(1);
  const results = items.map((item) => {
    const rubric = [
      ...(/Rubric:\n([\s\S]*?)\nAnswer:/.exec(item)?.[1] ?? "").matchAll(/^- (.+)$/gm),
    ]
      .map((m) => m[1])
      .filter(Boolean);
    const answer = (/Answer:\n([\s\S]*)$/.exec(item)?.[1] ?? "").toLowerCase();
    if (answer.trim().length < 15 || answer.trim() === "(blank)") {
      return { verdict: "not_met", feedback: "The answer is too short to mark. Say more." };
    }
    const covered = rubric.filter((r) => {
      const keys = words(r);
      return !keys.length || keys.filter((k) => answer.includes(k)).length / keys.length >= 0.5;
    }).length;
    const share = rubric.length ? covered / rubric.length : 1;
    const verdict = share >= 0.6 ? "met" : share >= 0.3 ? "partly" : "not_met";
    return {
      verdict,
      feedback: `Covers ${covered} of ${rubric.length} point(s) the playbook looks for.`,
    };
  });
  const met = results.filter((r) => r.verdict === "met").length;
  return {
    results: results.length ? results : [{ verdict: "not_met", feedback: "Nothing to mark." }],
    summary: `Mock marking: ${met} of ${results.length} answer(s) fully meet the rubric.`,
  };
}

/** Answers from the material lines that share the most words with the question, or says it doesn't know. */
export function mockOnboardingAsk(user: string) {
  const material = tagged(user, "onboarding_material");
  const question = words(tagged(user, "onboarding_question"));
  let heading = "";
  const scored = material
    .split("\n")
    .map((raw) => {
      const h = /^#{2,3}\s+(?:Workflow:\s+)?(.+)/.exec(raw);
      if (h) heading = h[1].replace(/\s*\(\w+\)$/, "").trim();
      const text = raw.replace(/^[-*•#\d.)\s]+/, "").trim();
      const lineWords = new Set(words(text));
      return { text, heading, hits: question.filter((w) => lineWords.has(w)).length };
    })
    .filter((l) => l.text.length > 3 && l.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  if (!scored.length) {
    return {
      answer:
        "I don't know that from the playbook or the handbook. Ask your manager, and they can add it for the next person.",
      known: false,
      from: [],
    };
  }
  const top = scored.slice(0, 2);
  return {
    answer: `From the playbook: ${top.map((l) => l.text).join(" ")}`,
    known: true,
    from: [...new Set(top.map((l) => l.heading).filter(Boolean))],
  };
}
