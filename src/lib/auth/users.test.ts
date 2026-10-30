import { describe, expect, it } from "vitest";
import { z } from "zod";
import { escapeLike, parseSuspendForm, parseUserListQuery } from "./users";

describe("parseUserListQuery", () => {
  it("defaults an empty query", () => {
    expect(parseUserListQuery({})).toEqual({ search: undefined, page: 1 });
  });

  it("trims the search and drops blanks", () => {
    expect(parseUserListQuery({ q: "  ada@example.com " })).toEqual({
      search: "ada@example.com",
      page: 1,
    });
    expect(parseUserListQuery({ q: "   " })).toEqual({ search: undefined, page: 1 });
  });

  it("caps the search length and ignores non-strings", () => {
    expect(parseUserListQuery({ q: "a".repeat(200) }).search).toHaveLength(120);
    expect(parseUserListQuery({ q: 42 }).search).toBeUndefined();
  });

  it("reads page numbers and falls back on bad ones", () => {
    expect(parseUserListQuery({ page: "3" }).page).toBe(3);
    for (const page of ["0", "-2", "abc", "", 1.5, null, {}]) {
      expect(parseUserListQuery({ page }).page, JSON.stringify(page)).toBe(1);
    }
  });
});

describe("escapeLike", () => {
  it("escapes LIKE wildcards", () => {
    expect(escapeLike("100%_sure\\now")).toBe("100\\%\\_sure\\\\now");
    expect(escapeLike("plain")).toBe("plain");
  });
});

describe("parseSuspendForm", () => {
  it("reads the intent as a boolean", () => {
    expect(parseSuspendForm({ userId: "u1", intent: "suspend" })).toEqual({
      userId: "u1",
      suspended: true,
    });
    expect(parseSuspendForm({ userId: "u1", intent: "unsuspend" })).toEqual({
      userId: "u1",
      suspended: false,
    });
  });

  it("rejects a missing user and unknown intents", () => {
    expect(() => parseSuspendForm({ userId: "", intent: "suspend" })).toThrow(z.ZodError);
    expect(() => parseSuspendForm({ userId: "u1", intent: "ban" })).toThrow(z.ZodError);
    expect(() => parseSuspendForm({})).toThrow(z.ZodError);
  });
});
