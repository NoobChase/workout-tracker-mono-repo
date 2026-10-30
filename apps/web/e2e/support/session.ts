import { expect, type Page } from "@playwright/test";

/**
 * Clerk's development instance's test identity: `+clerk_test` addresses take
 * the fixed code 424242, so no inbox and no secret. This account already
 * exists; the tests only ever sign in, never sign up.
 */
export const TEST_EMAIL = "spike+clerk_test@example.com";
export const TEST_CODE = "424242";

/**
 * Opens `/sign-in` signed out and signs in through the bundled Clerk form, as
 * a lifter would: email, "Use another method", the emailed code. (The test
 * account has a password too, so the form asks for it first.) It ends on
 * home, where signing in always lands. In the dev server `window.Clerk` is
 * not the instance React holds, so the form is the only reliable way in; it
 * is also the honest test of the sign-in screen. (Signed out, `/` is the
 * landing page, whose "Log in" leads here.)
 */
export async function signIn(page: Page): Promise<void> {
  await page.goto("/sign-in");
  await signInHere(page);
}

/** The same, on a page already showing the sign-in screen. */
export async function signInHere(page: Page): Promise<void> {
  await expect(
    page.getByRole("heading", { name: "Sign in to log today’s workout" }),
  ).toBeVisible({ timeout: 30_000 });
  await page
    .getByRole("textbox", { name: "Email address" })
    .fill(TEST_EMAIL, { timeout: 30_000 });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByText("Use another method").click();
  await page.getByText(/Email code to/).click();
  await expect(page.getByText("Check your email")).toBeVisible();
  const signedIn = page.getByRole("link", { name: "Tanren, home" });
  const unsent = page.getByText(
    "You need to send a verification code before attempting to verify.",
  );
  const code = page.getByRole("textbox", { name: "Enter verification code" });
  // Clerk's development instance sometimes drops the send (many parallel
  // sign-ins to one account): the countdown runs, but no code exists. Recover
  // as a person would: wait for Resend, resend, type the code again.
  for (let attempt = 1; ; attempt++) {
    await expect(
      page.getByRole("button", { name: /Resend \(\d+\)/ }),
    ).toBeVisible({ timeout: 15_000 });
    await code.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("Backspace");
    await code.pressSequentially(TEST_CODE);
    const outcome = await Promise.race([
      signedIn.waitFor({ timeout: 30_000 }).then(() => "in" as const),
      unsent.waitFor({ timeout: 30_000 }).then(() => "unsent" as const),
    ]);
    if (outcome === "in") break;
    // Clerk can flash that message and still sign in: give it a moment.
    const inAnyway = await signedIn
      .waitFor({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (inAnyway) break;
    if (attempt === 3) throw new Error("Clerk never sent the sign-in code");
    const resent = await Promise.race([
      page
        .getByRole("button", { name: /^Didn.t receive a code\? Resend$/ })
        .click({ timeout: 45_000 })
        .then(() => "resent" as const),
      signedIn.waitFor({ timeout: 45_000 }).then(() => "in" as const),
    ]);
    if (resent === "in") break;
  }
  await expect(signedIn).toBeVisible();
}
