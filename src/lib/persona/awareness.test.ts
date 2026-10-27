import { describe, expect, it } from "vitest";
import { ageText, notices, unseen, type NoticeFacts } from "./notices";
import {
  applyToneChange,
  effectiveTone,
  inferTone,
  toneFromMessage,
  toneInstruction,
} from "./tone";
import { matchWakeWord } from "./wake";

const now = new Date("2026-10-27T12:00:00Z");
const ago = (h: number) => new Date(now.getTime() - h * 3_600_000);
const facts = (over: Partial<NoticeFacts> = {}): NoticeFacts => ({
  now,
  day: "2026-10-27",
  waiting: [],
  scores: [],
  orders: [],
  viewingJobId: null,
  ...over,
});

describe("notices", () => {
  it("says how long a job has waited, once a day", () => {
    const [n] = notices(
      facts({
        waiting: [{ id: "j1", skill: "Minutes", createdAt: ago(49), flags: 0, origin: "owner" }],
      }),
    );
    expect(n.text).toBe("Your Minutes job has been waiting 2 days.");
    expect(n.key).toBe("wait:j1:2026-10-27");
  });

  it("groups several waiting jobs and ignores fresh ones", () => {
    const list = notices(
      facts({
        waiting: [
          { id: "a", skill: "Minutes", createdAt: ago(30), flags: 0, origin: "owner" },
          { id: "b", skill: "Minutes", createdAt: ago(72), flags: 0, origin: "renter" },
          { id: "c", skill: "Minutes", createdAt: ago(2), flags: 0, origin: "owner" },
        ],
      }),
    );
    expect(list).toHaveLength(1);
    expect(list[0].text).toBe("2 jobs are waiting for your review. The oldest has waited 3 days.");
  });

  it("speaks about the job on screen, with its flags", () => {
    const [n] = notices(
      facts({
        viewingJobId: "j1",
        waiting: [{ id: "j1", skill: "Minutes", createdAt: ago(3), flags: 2, origin: "owner" }],
      }),
    );
    expect(n.text).toBe("This Minutes job has been waiting 3 hours. I flagged 2 things on it.");
  });

  it("reports score drops and rises past a threshold, and new orders first", () => {
    const list = notices(
      facts({
        scores: [
          { slug: "m", skill: "Minutes", runId: "r1", latest: 68.2, previous: 74 },
          { slug: "s", skill: "SEO", runId: "r2", latest: 80, previous: 79 },
          { slug: "r", skill: "Reports", runId: "r3", latest: 85, previous: 78 },
        ],
        orders: [{ id: "o1", skill: "Minutes", renter: "Ada Obi", createdAt: ago(1) }],
      }),
    );
    expect(list.map((n) => n.text)).toEqual([
      "New order from Ada for Minutes.",
      "Your Minutes skill dropped to 68 (from 74). The last change may have hurt it.",
      "Nice: Reports is up to 85 (from 78).",
    ]);
  });

  it("drops notices already said and caps the rest", () => {
    const list = notices(
      facts({
        orders: ["a", "b", "c", "d"].map((id) => ({
          id,
          skill: "M",
          renter: "R",
          createdAt: ago(1),
        })),
      }),
    );
    expect(unseen(list, ["order:a"]).map((n) => n.key)).toEqual(["order:b", "order:c", "order:d"]);
    expect(ageText(30 * 60_000)).toBe("an hour");
  });
});

describe("tone", () => {
  it("reads explicit requests", () => {
    expect(toneFromMessage("Please keep it short")).toEqual({ length: "short" });
    expect(toneFromMessage("be more formal, and you can joke")).toEqual({
      formality: "formal",
      playful: true,
    });
    expect(toneFromMessage("remind me at 4")).toBeNull();
  });

  it("keeps notes without duplicates", () => {
    const t = applyToneChange(applyToneChange({}, { note: "Call me Ada" }), {
      length: "short",
      note: "call me ada",
    });
    expect(t).toEqual({ length: "short", notes: ["call me ada"] });
  });

  it("infers style from how the user writes, and explicit choices win", () => {
    const inferred = inferTone(["hey lol", "ok thx 😂", "do it"]);
    expect(inferred).toEqual({ length: "short", formality: "casual", playful: true });
    expect(effectiveTone({ formality: "formal" }, inferred).formality).toBe("formal");
    expect(inferTone(["one", "two"])).toEqual({});
  });

  it("turns tone into an instruction", () => {
    expect(toneInstruction({ length: "short", playful: true, notes: ["call me Ada"] })).toBe(
      "Keep replies to one short sentence when you can. Be warm and plain. A little light humour is welcome. They asked: call me Ada.",
    );
  });
});

describe("matchWakeWord", () => {
  it("wakes on greeting + name, with what followed", () => {
    expect(matchWakeWord("Hey Nova", "Nova")).toEqual({ rest: "" });
    expect(matchWakeWord("ok nova remind me at four", "Nova")).toEqual({
      rest: "remind me at four",
    });
    expect(matchWakeWord("um hey nava what's next", "Nova")).toEqual({ rest: "what's next" });
  });

  it("ignores the name alone or other names", () => {
    expect(matchWakeWord("nova is a star", "Nova")).toBeNull();
    expect(matchWakeWord("hey nina", "Nova")).toBeNull();
    expect(matchWakeWord("hey ox", "Ox")).toEqual({ rest: "" });
    expect(matchWakeWord("hey of", "Ox")).toBeNull();
  });
});
