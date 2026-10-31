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
  // Sign-up has its own path through the UI; here it's only the way in.
  // Sign-ups are rate limited per address, which repeat runs can reach.
  await expect(async () => {
    const signedUp = await page.request.post("/api/auth/sign-up/email", {
      data: { name: "Voice E2E", email, password: "voice-e2e-password" },
      headers: { origin: "http://127.0.0.1:3110" },
    });
    expect(signedUp.status()).toBe(200);
  }).toPass({ timeout: 30_000, intervals: [2_000] });
  await page.goto("/companion");

  // The first meeting: a name, a look, and the sample task.
  const input = page.getByPlaceholder("Type, or tap me and just talk");
  await expect(input).toBeVisible({ timeout: 30_000 });
  await input.fill("Nova");
  await input.press("Enter");
  await page
    .getByRole("button", { name: / look$/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Try the sample" }).click();

  // Talking starts a conversation; the fake mic's pause ends the turn.
  const orb = page.getByTitle(/Tap to talk/);
  await expect(orb).toBeVisible({ timeout: 30_000 });
  const streamDone = page.waitForResponse(
    (response) =>
      response.url().includes("/api/persuna/chat-stream") && response.request().method() === "POST",
    { timeout: 90_000 },
  );
  // Persuna may be saying its welcome, and a tap then only interrupts it: keep
  // going until the conversation has really started. Never tap once it has,
  // because a second tap ends it.
  await expect(async () => {
    if ((await orb.getAttribute("aria-pressed")) !== "true") await orb.click();
    await expect(orb).toHaveAttribute("aria-pressed", "true", { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  const response = await streamDone;
  // A finished stream's body isn't kept, so the proof is on screen.
  expect(response.ok()).toBe(true);
  // The mock transcriber heard the fake mic: its "I always…" reached the mock
  // brain, which turned it into a learned rule for the sample skill.
  await expect(page.getByText(/Thanks, I've/)).toBeVisible({ timeout: 30_000 });
});
