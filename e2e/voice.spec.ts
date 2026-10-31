import { expect, test } from "@playwright/test";

/**
 * The voice path, end to end (plan §7): a new account meets Persuna, then asks
 * a spoken question on Chromium's fake microphone. Models are mocks, so the
 * mock transcriber hears the fake mic and the mock brain answers — what this
 * guards is the wiring: mic → turn → reply on screen.
 */
test("a spoken question on a fake mic gets a reply", async ({ page, context }) => {
  await context.grantPermissions(["microphone"]);
  const email = `voice-e2e-${Date.now()}@example.com`;
  await page.goto("/sign-up?next=/companion");
  await page.getByLabel("Your name").fill("Voice E2E");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("voice-e2e-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/companion/, { timeout: 30_000 });

  // The first meeting: a name, a look, and the sample task.
  const input = page.getByPlaceholder("Type, or hold to talk");
  await expect(input).toBeVisible({ timeout: 30_000 });
  await input.fill("Nova");
  await input.press("Enter");
  await input.fill("purple");
  await input.press("Enter");
  await input.fill("sample");
  await input.press("Enter");

  // Talking starts a conversation; the fake mic's beeps end the turn
  // on a pause (or the long-turn cap) — no second tap: stopping sends nothing.
  const orb = page.getByTitle(/Tap to talk/);
  await expect(orb).toBeVisible({ timeout: 30_000 });
  const streamDone = page.waitForResponse(
    (response) =>
      response.url().includes("/api/persuna/chat-stream") && response.request().method() === "POST",
    { timeout: 90_000 },
  );
  await orb.click();
  const response = await streamDone;
  const body = await response.text();
  expect(body).toContain("event: done");
  // The mock transcriber heard the fake mic.
  expect(body).toContain("Mock transcript");
  // And the mock brain's reply is on screen (the transcript's "I always…"
  // becomes a learned rule for the sample skill).
  await expect(page.getByText(/Thanks, I've/)).toBeVisible({ timeout: 30_000 });
});
