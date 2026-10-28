import { describe, expect, it } from "vitest";
import { readToken, seal, signToken, unseal } from "./crypto";

const KEY = "a-long-connections-key-used-only-in-tests";

describe("sealed tokens", () => {
  it("round-trips, and differs each time", () => {
    const a = seal("ya29.secret-token", KEY);
    expect(unseal(a, KEY)).toBe("ya29.secret-token");
    expect(seal("ya29.secret-token", KEY)).not.toBe(a);
    expect(a).not.toContain("secret-token");
  });

  it("refuses the wrong key or a tampered token", () => {
    const a = seal("token", KEY);
    expect(() => unseal(a, "another-key-of-reasonable-length-here")).toThrow();
    const parts = a.split(".");
    parts[3] = Buffer.from("other").toString("base64url");
    expect(() => unseal(parts.join("."), KEY)).toThrow();
  });
});

describe("signed action tokens", () => {
  it("carries a value until it expires", () => {
    const t = signToken({ tool: "gmail_send" }, KEY, 2000);
    expect(readToken(t, KEY, 1000)).toEqual({ tool: "gmail_send" });
    expect(readToken(t, KEY, 3000)).toBeNull();
  });

  it("refuses forgeries", () => {
    const t = signToken({ user: "a" }, KEY, 9e15);
    const [, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ v: { user: "b" }, e: 9e15 })).toString("base64url");
    expect(readToken(`${forged}.${sig}`, KEY)).toBeNull();
  });
});
