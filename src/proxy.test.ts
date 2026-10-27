import { describe, expect, it } from "vitest";
import { isPublicPath } from "./proxy";
import { matchesList, parseList, signUpAllowed } from "./lib/auth/policy";

describe("isPublicPath", () => {
  it("opens the landing page, auth pages, auth API and employer links", () => {
    for (const p of ["/", "/sign-in", "/sign-up", "/api/auth/sign-in/email", "/approvals/abc"]) {
      expect(isPublicPath(p)).toBe(true);
    }
  });

  it("keeps the studio behind sign-in", () => {
    for (const p of ["/skills", "/jobs/1", "/market", "/settings", "/sign-in-x", "/approvals"]) {
      expect(isPublicPath(p)).toBe(false);
    }
  });
});

describe("sign-up and admin lists", () => {
  const list = parseList(" ada@example.org, @gamaid.org ,, ");

  it("parses emails and domains, case-insensitively", () => {
    expect(list).toEqual(["ada@example.org", "@gamaid.org"]);
    expect(matchesList("ADA@example.org", list)).toBe(true);
    expect(matchesList("anyone@gamaid.org", list)).toBe(true);
    expect(matchesList("anyone@notgamaid.org", list)).toBe(false);
  });

  it("allows everyone when the allowlist is empty", () => {
    expect(signUpAllowed("x@y.z", [])).toBe(true);
    expect(signUpAllowed("x@y.z", list)).toBe(false);
  });
});
