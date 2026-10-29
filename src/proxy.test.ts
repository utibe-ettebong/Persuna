import { describe, expect, it } from "vitest";
import { isPublicPath } from "./proxy";
import { matchesList, parseList, signUpAllowed } from "./lib/auth/policy";

describe("isPublicPath", () => {
  it("opens the landing page, auth pages, auth API, employer links, public persuna profiles, the marketplace and the projects board", () => {
    for (const p of [
      "/",
      "/sign-in",
      "/sign-up",
      "/api/auth/sign-in/email",
      "/approvals/abc",
      "/persunas/owl-ab12c",
      "/download",
      "/download/mac-arm64",
      "/download/win-x64",
      "/welcome",
      "/desktop/setup",
      "/api/desktop/sign-in",
      "/market",
      "/market/0b9d1a2e-6c1f-4f7e-9a51-1f2d3c4b5a69",
      "/projects",
      "/projects/0b9d1a2e-6c1f-4f7e-9a51-1f2d3c4b5a69",
    ]) {
      expect(isPublicPath(p)).toBe(true);
    }
  });

  it("keeps the studio behind sign-in", () => {
    for (const p of [
      "/skills",
      "/jobs/1",
      "/market/orders/0b9d1a2e-6c1f-4f7e-9a51-1f2d3c4b5a69",
      "/market/orders/0b9d1a2e-6c1f-4f7e-9a51-1f2d3c4b5a69/paid",
      "/projects/new",
      "/projects/0b9d1a2e-6c1f-4f7e-9a51-1f2d3c4b5a69/edit",
      "/settings",
      "/sign-in-x",
      "/approvals",
      "/persuna",
      "/companion",
      "/desktop/connect",
      "/download/anything-else",
    ]) {
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
