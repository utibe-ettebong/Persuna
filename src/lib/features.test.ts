import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { deterministicFlags, mergeFlags } from "./jobs/self-check";
import {
  canSetLevel,
  DEFAULT_THRESHOLDS,
  eligibility,
  needsOwnerReview,
  type TrustRecord,
} from "./jobs/trust";
import { createMockClient } from "./models/mock";
import { mockTranscriber, readAudio } from "./models/transcribe";
import { createPaystack, toKobo, validWebhookSignature } from "./payments/paystack";
import { findNames, proposeFromNotes, selfCheck } from "./skill/engine";
import { answeredQuestions, interviewText } from "./skill/interview";
import { redactTogether, scanText } from "./skill/redact";
import type { SkillSheet } from "./skill/types";

const sheet: SkillSheet = {
  summary: "Formal minutes.",
  rules: [{ id: "R1", category: "structure", text: "Open with a header block." }],
  template: "# Minutes: …",
};

describe("name redaction", () => {
  const entities = [
    { text: "Ada O.", kind: "person" as const },
    { text: "Musa", kind: "person" as const },
    { text: "Grace Foundation", kind: "organisation" as const },
  ];

  it("numbers each entity once and uses the same placeholder in input and output", () => {
    const input = "present: Ada O. (chair), Musa\n- ada opened. musa to call Grace Foundation";
    const output = "**Chair:** Ada O.\n| Musa | Call Grace Foundation | Friday |";
    const [a, b] = redactTogether(
      [input, output],
      [scanText(input, entities), scanText(output, entities)],
      entities,
    );
    expect(a).toBe(
      "present: [PERSON 1] (chair), [PERSON 2]\n- [PERSON 1] opened. [PERSON 2] to call [ORG 1]",
    );
    expect(b).toBe("**Chair:** [PERSON 1]\n| [PERSON 2] | Call [ORG 1] | Friday |");
  });

  it("does not match names inside other words", () => {
    expect(scanText("Musashi met nobody", [{ text: "Musa", kind: "person" }])).toEqual([]);
  });

  it("combines with pattern findings without overlapping", () => {
    const findings = scanText("Email musa@example.org or Musa", [{ text: "Musa", kind: "person" }]);
    expect(findings.map((f) => f.kind)).toEqual(["email", "person"]);
  });

  // The mock only treats capitalised words as names mid-sentence or in attendee lists;
  // the real model reads context. Sentence-initial names outside those are a known mock gap.
  it("the mock model finds attendees and capitalised names, not section words", async () => {
    const names = await findNames(createMockClient(), [
      "budget review\npresent: Ada O. (chair), Musa, Ngozi. Kemi sent apologies\n- agreed that Tunde will update the plan",
      "# Minutes: Budget Review\n**Date:** Tuesday\n## Action items",
    ]);
    const texts = names.map((n) => n.text);
    expect(texts).toEqual(expect.arrayContaining(["Ada O.", "Musa", "Ngozi", "Tunde"]));
    expect(texts).not.toContain("Tuesday");
    expect(texts).not.toContain("Minutes");
  });
});

describe("name redaction with browser line endings", () => {
  it("finds attendees when lines end in CRLF, as browser forms send them", async () => {
    const names = await findNames(createMockClient(), [
      "finance mtg\r\npresent: Bisi A. (chair), Emeka\r\n- bisi opened",
    ]);
    expect(names.map((n) => n.text)).toEqual(["Bisi A.", "Emeka"]);
  });
});

describe("self-check", () => {
  it("flags numbers in the draft that are not in the input", () => {
    const flags = deterministicFlags(
      "closed 10:15, budget 50k",
      "Closed at 10:15. Budget 75k.",
      [],
    );
    expect(flags).toEqual([
      expect.objectContaining({ kind: "invented_detail", message: expect.stringContaining("75k") }),
    ]);
  });

  it("flags inputs far shorter or longer than the training examples", () => {
    expect(deterministicFlags("hi", "Hi.", [400, 500, 600])[0]?.kind).toBe("unusual_input");
    expect(deterministicFlags("x".repeat(5000), "x", [400, 500, 600])[0]?.kind).toBe(
      "unusual_input",
    );
    expect(deterministicFlags("x".repeat(500), "x", [400, 500, 600])).toEqual([]);
  });

  it("merges model and deterministic flags without duplicates", () => {
    const f = { kind: "uncertain" as const, message: "x" };
    expect(mergeFlags([f], [f])).toEqual([f]);
  });

  it("the mock self-check flags a missing date and attendee list", async () => {
    const flags = await selfCheck(
      createMockClient(),
      sheet,
      "notes: agreed to buy chairs",
      "Draft.",
      [],
    );
    expect(flags.map((f) => f.kind)).toEqual(["missing_info", "missing_info"]);
  });
});

describe("trust ladder", () => {
  const record = (over: Partial<TrustRecord> = {}): TrustRecord => ({
    reviewed: 25,
    clean: 24,
    rejected: 0,
    jobsAtLevel1: 0,
    rejectedAtLevel1: 0,
    complaints: 0,
    ...over,
  });

  it("earns level 1 with enough clean reviewed jobs and no complaints", () => {
    expect(canSetLevel(1, record(), DEFAULT_THRESHOLDS)).toBe(true);
    expect(canSetLevel(1, record({ reviewed: 10, clean: 10 }), DEFAULT_THRESHOLDS)).toBe(false);
    expect(canSetLevel(1, record({ clean: 20 }), DEFAULT_THRESHOLDS)).toBe(false);
    expect(canSetLevel(1, record({ complaints: 1 }), DEFAULT_THRESHOLDS)).toBe(false);
  });

  it("earns level 2 only after a clean record at level 1", () => {
    expect(canSetLevel(2, record({ jobsAtLevel1: 60 }), DEFAULT_THRESHOLDS)).toBe(true);
    expect(
      canSetLevel(2, record({ jobsAtLevel1: 60, rejectedAtLevel1: 1 }), DEFAULT_THRESHOLDS),
    ).toBe(false);
    expect(eligibility(record(), DEFAULT_THRESHOLDS)[0].eligible).toBe(true);
  });

  it("routes jobs: flags, premium review and level 0 always go to the owner", () => {
    const base = { level: 1, flagged: false, ownerReviewRequired: false, spotCheckEvery: 5 };
    expect(needsOwnerReview(base)).toBe(false);
    expect(needsOwnerReview({ ...base, level: 0 })).toBe(true);
    expect(needsOwnerReview({ ...base, flagged: true })).toBe(true);
    expect(needsOwnerReview({ ...base, ownerReviewRequired: true })).toBe(true);
  });

  it("spot-checks a sample at level 2", () => {
    const base = { level: 2, flagged: false, ownerReviewRequired: false, spotCheckEvery: 5 };
    expect(needsOwnerReview({ ...base, random: () => 0.1 })).toBe(true);
    expect(needsOwnerReview({ ...base, random: () => 0.5 })).toBe(false);
  });
});

describe("interview and voice", () => {
  it("keeps only answered questions, in order", () => {
    const answers = { tone: "Formal.", steps: "  ", alwaysCut: "Small talk." };
    expect(answeredQuestions(answers).map((q) => q.key)).toEqual(["alwaysCut", "tone"]);
    expect(interviewText(answers)).toContain("A: Small talk.");
    expect(interviewText(null)).toBe("");
  });

  it("turns described method into proposed rules through the mock", async () => {
    const { sheet: next, proposal } = await proposeFromNotes(
      createMockClient(),
      sheet,
      "Q: What do you always leave out?\nA: I always leave out small talk and jokes.\n\nQ: Tone?\nA: Formal third person past tense always.",
    );
    expect(proposal.ops).toHaveLength(2);
    expect(next.rules.map((r) => r.category)).toEqual(["structure", "cut", "tone"]);
  });

  it("the mock transcriber returns a walkthrough and refuses empty audio", async () => {
    const t = await mockTranscriber.transcribe(new Blob(["x"]), "a.webm");
    expect(t.text).toMatch(/header block/);
    await expect(mockTranscriber.transcribe(new Blob([]), "a.webm")).rejects.toThrow(/empty/);
  });

  it("accepts recorded blobs and audio uploads, rejects other files", () => {
    expect(readAudio(new File(["x"], "blob", { type: "audio/webm" }))?.name).toBe("recording.webm");
    expect(readAudio(new File(["x"], "talk.m4a"))?.name).toBe("talk.m4a");
    expect(readAudio(null)).toBeNull();
    expect(() => readAudio(new File(["x"], "notes.pdf"))).toThrow(/audio file/);
  });
});

describe("Paystack", () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it("initialises a checkout in kobo with the reference and callback", async () => {
    const fetchImpl = vi.fn(async () =>
      ok({
        status: true,
        message: "ok",
        data: {
          authorization_url: "https://checkout.paystack.com/x",
          access_code: "a",
          reference: "r",
        },
      }),
    );
    const res = await createPaystack("sk_test_123456", fetchImpl as typeof fetch).initialize({
      email: "a@b.co",
      amountNgn: 5000,
      reference: "persuna-1",
      callbackUrl: "https://app.test/cb",
    });
    expect(res.authorizationUrl).toBe("https://checkout.paystack.com/x");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.paystack.co/transaction/initialize");
    expect(JSON.parse(init.body as string)).toMatchObject({
      amount: 500000,
      currency: "NGN",
      reference: "persuna-1",
      callback_url: "https://app.test/cb",
    });
  });

  it("reports verified payments in naira", async () => {
    const fetchImpl = vi.fn(async () =>
      ok({
        status: true,
        data: { status: "success", reference: "r", amount: 500000, currency: "NGN" },
      }),
    );
    expect(await createPaystack("sk_test_123456", fetchImpl as typeof fetch).verify("r")).toEqual({
      paid: true,
      amountNgn: 5000,
      currency: "NGN",
    });
  });

  it("surfaces Paystack's error message", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ message: "Invalid key" }), { status: 401 }),
    );
    await expect(
      createPaystack("sk_test_123456", fetchImpl as typeof fetch).verify("r"),
    ).rejects.toThrow("Paystack: Invalid key");
  });

  it("accepts only correctly signed webhooks", () => {
    const body = JSON.stringify({ event: "charge.success", data: { reference: "persuna-1" } });
    const signature = createHmac("sha512", "sk_test_secret").update(body).digest("hex");
    expect(validWebhookSignature(body, signature, "sk_test_secret")).toBe(true);
    expect(validWebhookSignature(body, signature, "sk_test_other")).toBe(false);
    expect(validWebhookSignature(`${body} `, signature, "sk_test_secret")).toBe(false);
    expect(validWebhookSignature(body, null, "sk_test_secret")).toBe(false);
  });

  it("converts naira to kobo", () => {
    expect(toKobo(5000)).toBe(500000);
  });
});

describe("key slots", () => {
  it("treats empty and paste-here values as unset", async () => {
    const { isPlaceholder } = await import("@/env");
    expect(isPlaceholder(undefined)).toBe(true);
    expect(isPlaceholder("  ")).toBe(true);
    expect(isPlaceholder("PASTE_META_API_KEY_HERE")).toBe(true);
    expect(isPlaceholder("paste-baseten-key")).toBe(true);
    expect(isPlaceholder("sk-live-abc123")).toBe(false);
    expect(isPlaceholder("https://inference.baseten.co/v1")).toBe(false);
  });

  it("stays on mock models while the Learn key is a placeholder, and falls back per role", async () => {
    const { modelProvider, modelConfig } = await import("@/env");
    const saved = { ...process.env };
    try {
      delete process.env.MODEL_PROVIDER;
      process.env.EXTRACT_API_KEY = "PASTE_META_API_KEY_HERE";
      expect(modelProvider()).toBe("mock");

      process.env.EXTRACT_API_KEY = "real-meta-key";
      process.env.EXTRACT_BASE_URL = "https://meta.example/v1";
      process.env.EXTRACT_MODEL = "muse-spark";
      process.env.DRAFT_API_KEY = "PASTE_BASETEN_API_KEY_HERE";
      process.env.DRAFT_BASE_URL = "https://inference.baseten.co/v1";
      process.env.DRAFT_MODEL = "PASTE_BASETEN_MODEL_ID_HERE";
      expect(modelProvider()).toBe("live");
      // Until the Baseten key is pasted, drafting borrows the Meta settings as a whole set.
      expect(modelConfig("draft")).toEqual({
        baseUrl: "https://meta.example/v1",
        apiKey: "real-meta-key",
        model: "muse-spark",
      });
      // Same provider, different model: transcription can name its own model on the Meta key.
      process.env.TRANSCRIBE_MODEL = "muse-voice-transcribe";
      const { transcriptionConfig } = await import("@/env");
      expect(transcriptionConfig()).toEqual({
        baseUrl: "https://meta.example/v1",
        apiKey: "real-meta-key",
        model: "muse-voice-transcribe",
      });
      process.env.DRAFT_API_KEY = "real-baseten-key";
      process.env.DRAFT_MODEL = "muse-spark-open";
      expect(modelConfig("draft")).toEqual({
        baseUrl: "https://inference.baseten.co/v1",
        apiKey: "real-baseten-key",
        model: "muse-spark-open",
      });
    } finally {
      process.env = saved;
    }
  });
});
