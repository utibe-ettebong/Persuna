import { describe, expect, it } from "vitest";
import { dollarsField, dollarsInput, formatMoney, formatUsd, parseDollars } from "./money";

describe("formatUsd", () => {
  it("shows whole dollars without cents and other amounts with two decimals", () => {
    expect(formatUsd(1200)).toBe("$12");
    expect(formatUsd(1250)).toBe("$12.50");
    expect(formatUsd(5)).toBe("$0.05");
    expect(formatUsd(123456789)).toBe("$1,234,567.89");
    expect(formatUsd(0)).toBe("$0");
    expect(formatUsd(-250)).toBe("−$2.50");
  });

  it("refuses fractions of a cent", () => {
    expect(() => formatUsd(12.5)).toThrow();
  });
});

describe("formatMoney", () => {
  it("shows old naira payments in naira and everything else in dollars", () => {
    expect(formatMoney(650000, "NGN")).toBe("₦6,500");
    expect(formatMoney(650050, "NGN")).toBe("₦6,500.50");
    expect(formatMoney(650, "USD")).toBe("$6.50");
  });
});

describe("parseDollars", () => {
  it("reads typed dollar amounts as cents", () => {
    expect(parseDollars("12")).toBe(1200);
    expect(parseDollars("12.5")).toBe(1250);
    expect(parseDollars("12.50")).toBe(1250);
    expect(parseDollars(" $12.05 ")).toBe(1205);
    expect(parseDollars("1,250.00")).toBe(125000);
    expect(parseDollars("0.99")).toBe(99);
  });

  it("rejects anything that isn't a plain amount", () => {
    for (const bad of ["", "abc", "-5", "12.505", "1.2.3", "12,5", "$", ".50", "1e3"]) {
      expect(parseDollars(bad)).toBeNull();
    }
  });
});

describe("dollarsInput", () => {
  it("round-trips with parseDollars", () => {
    expect(dollarsInput(1250)).toBe("12.50");
    expect(dollarsInput(1200)).toBe("12");
    expect(dollarsInput(null)).toBe("");
    for (const cents of [1, 99, 100, 1205, 999999]) {
      expect(parseDollars(dollarsInput(cents))).toBe(cents);
    }
  });
});

describe("dollarsField", () => {
  const field = dollarsField("Price", 100, 10_000);

  it("parses to cents within the limits", () => {
    expect(field.parse("12.50")).toBe(1250);
  });

  it("explains what is wrong", () => {
    expect(field.safeParse("0.50").error?.issues[0].message).toBe("Price: at least $1");
    expect(field.safeParse("101").error?.issues[0].message).toBe("Price: at most $100");
    expect(field.safeParse("ten").error?.issues[0].message).toMatch(/enter dollars/);
  });
});
