import { describe, expect, it } from "vitest";
import { isAuthorized } from "./proxy";

const basic = (user: string, pass: string) =>
  `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

describe("isAuthorized", () => {
  it("accepts the right password with any username", () => {
    expect(isAuthorized(basic("anyone", "correct-horse"), "correct-horse")).toBe(true);
  });

  it("keeps colons that are part of the password", () => {
    expect(isAuthorized(basic("u", "a:b:c"), "a:b:c")).toBe(true);
  });

  it("rejects wrong, missing and non-basic credentials", () => {
    expect(isAuthorized(basic("u", "wrong"), "correct-horse")).toBe(false);
    expect(isAuthorized(null, "correct-horse")).toBe(false);
    expect(isAuthorized("Bearer correct-horse", "correct-horse")).toBe(false);
  });
});
