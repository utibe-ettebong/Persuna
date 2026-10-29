import { describe, expect, it } from "vitest";
import {
  displayName,
  initialsOf,
  moveItem,
  portfolioInput,
  profileInput,
  ratingSummary,
  safeUrl,
} from "./rules";

describe("safeUrl", () => {
  it("accepts https and bare domains", () => {
    expect(safeUrl("https://example.com/work")).toBe("https://example.com/work");
    expect(safeUrl(" behance.net/ada ")).toBe("https://behance.net/ada");
  });

  it("refuses anything that isn't https", () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,hi",
      "http://example.com",
      "localhost",
    ]) {
      expect(() => safeUrl(bad)).toThrow();
    }
  });
});

describe("profile and portfolio input", () => {
  it("turns blanks into nothing and checks the website", () => {
    const p = profileInput.parse({
      publicName: " ",
      headline: "Writer",
      bio: "",
      location: "",
      website: "",
    });
    expect(p).toEqual({
      publicName: null,
      headline: "Writer",
      bio: null,
      location: null,
      website: null,
    });
    expect(
      profileInput.safeParse({
        publicName: "",
        headline: "",
        bio: "",
        location: "",
        website: "javascript:x",
      }).success,
    ).toBe(false);
  });

  it("needs a title and safe links", () => {
    expect(portfolioInput.safeParse({ title: "", link: "" }).success).toBe(false);
    const ok = portfolioInput.parse({
      title: "Board minutes",
      link: "example.com/m",
      imageUrl: "",
    });
    expect(ok.link).toBe("https://example.com/m");
    expect(ok.imageUrl).toBeNull();
  });
});

describe("displayName, ratings and order", () => {
  it("uses the chosen name, else the first name", () => {
    expect(displayName("Ada O.", "Ada Obi")).toBe("Ada O.");
    expect(displayName(null, "Ada Obi")).toBe("Ada");
  });

  it("averages ratings to one decimal", () => {
    expect(ratingSummary([5, 4, null, 4])).toEqual({ count: 3, average: 4.3 });
    expect(ratingSummary([])).toEqual({ count: 0, average: null });
  });

  it("moves a piece up or down, not past the ends", () => {
    expect(moveItem(["a", "b", "c"], "b", "up")).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], "c", "down")).toEqual(["a", "b", "c"]);
  });
});

describe("initialsOf", () => {
  it("takes two initials, or the email's first letter", () => {
    expect(initialsOf("Utibe Ettebong", "u@x.org")).toBe("UE");
    expect(initialsOf("", "ada@x.org")).toBe("A");
  });
});
