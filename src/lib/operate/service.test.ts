import { describe, expect, it } from "vitest";
import {
  cancelOperate,
  cancelOperateToken,
  confirmOperate,
  proposeOperate,
  settleOperate,
  type OperateOutcome,
} from "./service";

const SECRET = "test-secret-for-operate-tokens";
const CLICK = { kind: "click", x: 10, y: 20, label: "Send" } as const;
const OUTCOME: OperateOutcome = { status: "done" };

describe("proposeOperate", () => {
  it("proposes only in Work mode, with a preview of the approved action", () => {
    const proposal = proposeOperate("u1", "work", CLICK, { secret: SECRET });
    expect(proposal.preview).toBe('Click "Send" at 10, 20');
    expect(proposal.action).toMatchObject(CLICK);
    expect(typeof proposal.token).toBe("string");
  });

  it("refuses Talk and Look modes and unsafe actions", () => {
    expect(() => proposeOperate("u1", "talk", CLICK, { secret: SECRET })).toThrow(/Work mode/);
    expect(() => proposeOperate("u1", "look", CLICK, { secret: SECRET })).toThrow(/Work mode/);
    expect(() => proposeOperate("u1", "work", { kind: "click" }, { secret: SECRET })).toThrow();
  });
});

describe("confirmOperate", () => {
  it("confirms once, for the same user, before expiry", () => {
    const { token } = proposeOperate("u1", "work", CLICK, { secret: SECRET });
    const confirmed = confirmOperate("u1", token, { secret: SECRET });
    expect(confirmed.action).toMatchObject(CLICK);
    expect(typeof confirmed.execToken).toBe("string");
    expect(() => confirmOperate("u1", token, { secret: SECRET })).toThrow(/already/);
  });

  it("rejects other users, forged tokens and expired proposals", () => {
    const { token } = proposeOperate("u1", "work", CLICK, { secret: SECRET });
    expect(() => confirmOperate("u2", token, { secret: SECRET })).toThrow(/expired/);
    expect(() => confirmOperate("u1", "forged.token", { secret: SECRET })).toThrow(/expired/);
    const old = proposeOperate("u1", "work", CLICK, { secret: SECRET, now: 1_000 });
    expect(() => confirmOperate("u1", old.token, { secret: SECRET, now: 2_000_000 })).toThrow(
      /expired/,
    );
  });
});

describe("settleOperate", () => {
  it("settles an execution once, with its outcome", () => {
    const { token } = proposeOperate("u1", "work", CLICK, { secret: SECRET });
    const { execToken } = confirmOperate("u1", token, { secret: SECRET });
    const settled = settleOperate("u1", execToken, OUTCOME, { secret: SECRET });
    expect(settled.outcome).toEqual(OUTCOME);
    expect(() => settleOperate("u1", execToken, OUTCOME, { secret: SECRET })).toThrow(/already/);
  });

  it("reports a take-over as its own outcome", () => {
    const { token } = proposeOperate("u1", "work", CLICK, { secret: SECRET });
    const { execToken } = confirmOperate("u1", token, { secret: SECRET });
    const settled = settleOperate(
      "u1",
      execToken,
      { status: "took_over", detail: "mouse moved" },
      { secret: SECRET },
    );
    expect(settled.outcome.status).toBe("took_over");
  });
});

describe("cancelOperate", () => {
  it("the stop word blocks both confirm and settle", () => {
    const proposal = proposeOperate("u1", "work", CLICK, { secret: SECRET });
    cancelOperate(proposal.id);
    expect(() => confirmOperate("u1", proposal.token, { secret: SECRET })).toThrow(/cancelled/);

    const live = proposeOperate("u1", "work", CLICK, { secret: SECRET });
    const confirmed = confirmOperate("u1", live.token, { secret: SECRET });
    expect(confirmed.id).toBe(live.id);
    cancelOperate(live.id);
    expect(() => settleOperate("u1", confirmed.execToken, OUTCOME, { secret: SECRET })).toThrow(
      /cancelled/,
    );
  });

  it("cancels by token only for the user it was proposed to", () => {
    const proposal = proposeOperate("u1", "work", CLICK, { secret: SECRET });
    expect(() => cancelOperateToken("u2", proposal.token, { secret: SECRET })).toThrow(/expired/);
    const id = cancelOperateToken("u1", proposal.token, { secret: SECRET });
    expect(id).toBe(proposal.id);
    expect(() => confirmOperate("u1", proposal.token, { secret: SECRET })).toThrow(/cancelled/);
  });
});

describe("the two tokens", () => {
  it("can't be swapped, and approving twice is refused however it's asked", () => {
    const { token } = proposeOperate("u1", "work", CLICK, { secret: SECRET });
    const { execToken } = confirmOperate("u1", token, { secret: SECRET });

    expect(() => confirmOperate("u1", execToken, { secret: SECRET })).toThrow();
    expect(() => confirmOperate("u1", token, { secret: SECRET })).toThrow();
    expect(() => settleOperate("u1", token, OUTCOME, { secret: SECRET })).toThrow();
  });

  it("expires in minutes, because the screen moves on", () => {
    const now = Date.now();
    const { token } = proposeOperate("u1", "work", CLICK, { secret: SECRET, now });
    expect(() => confirmOperate("u1", token, { secret: SECRET, now: now + 3 * 60_000 })).toThrow();
  });
});
