/**
 * Money is held as integer minor units: US cents for everything priced in
 * dollars, and kobo for the naira payments made before the marketplace
 * switched to dollars. Never floats.
 */
import { z } from "zod";

export type Currency = "USD" | "NGN";

/** "$12" for whole dollars, "$12.50" otherwise, with thousands separators. */
export function formatUsd(cents: number): string {
  return formatMinor(cents, "$");
}

/** Any stored amount in its own currency. NGN only appears on old payment history. */
export function formatMoney(minor: number, currency: string): string {
  return currency === "NGN" ? formatMinor(minor, "₦") : formatUsd(minor);
}

function formatMinor(minor: number, symbol: string): string {
  if (!Number.isInteger(minor)) throw new Error("Amounts are whole minor units");
  const sign = minor < 0 ? "−" : "";
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  const cents = abs % 100;
  return `${sign}${symbol}${whole}${cents ? `.${String(cents).padStart(2, "0")}` : ""}`;
}

/**
 * Reads a dollar amount someone typed ("12", "12.5", "12.50", "$1,250.00")
 * as cents. Null for anything else, including negatives and fractions of a cent.
 */
export function parseDollars(text: string): number | null {
  const cleaned = text
    .trim()
    .replace(/^\$/, "")
    .replace(/,(?=\d{3}(\D|$))/g, "");
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/** Cents as the text a dollar input shows: 1250 → "12.50", 1200 → "12". */
export function dollarsInput(cents: number | null | undefined): string {
  if (cents == null) return "";
  return cents % 100 ? (cents / 100).toFixed(2) : String(cents / 100);
}

/** A form field holding dollars, parsed to cents between `min` and `max` cents. */
export function dollarsField(label: string, minCents: number, maxCents: number) {
  return z.string().transform((text, ctx) => {
    const cents = parseDollars(text);
    const message =
      cents === null
        ? `${label}: enter dollars, like 12 or 12.50`
        : cents < minCents
          ? `${label}: at least ${formatUsd(minCents)}`
          : cents > maxCents
            ? `${label}: at most ${formatUsd(maxCents)}`
            : null;
    if (message) {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
    return cents!;
  });
}
