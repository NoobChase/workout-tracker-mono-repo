import { expect, test } from "@playwright/test";

/*
 * Task 7.2: the landing page at phone and desktop width, in both themes,
 * against the dev server. No sign-in: it is the signed-out `/`.
 */

const BG = { light: "rgb(244, 241, 236)", dark: "rgb(19, 18, 16)" } as const;

for (const width of [375, 1280] as const) {
  for (const colorScheme of ["light", "dark"] as const) {
    test.describe(`${width}px, ${colorScheme}`, () => {
      test.use({
        viewport: { width, height: width === 375 ? 812 : 800 },
        colorScheme,
      });

      test("fits the width, follows the theme, and offers both ways in", async ({
        page,
      }) => {
        await page.goto("/");
        await expect(
          page.getByRole("heading", { name: /Three things/ }),
        ).toBeVisible();
        expect(
          await page.evaluate(
            () => getComputedStyle(document.body).backgroundColor,
          ),
        ).toBe(BG[colorScheme]);

        // No horizontal scroll, the strokes drawn or not.
        for (const wait of [0, 4_000]) {
          await page.waitForTimeout(wait);
          expect(
            await page.evaluate(
              () =>
                document.documentElement.scrollWidth -
                document.documentElement.clientWidth,
            ),
          ).toBeLessThanOrEqual(0);
        }

        const banner = page.getByRole("banner");
        await expect(banner).toHaveText(/^TANREN/i);
        await expect(banner).not.toHaveText(/[鍛錬]/);
        await expect(
          banner.getByRole("link", { name: "Log in" }),
        ).toBeVisible();
        // The phone header has room for Log in; sign-up leads from the hero.
        await expect(
          page.getByRole("link", { name: "Start training" }).first(),
        ).toBeVisible();
        await expect(
          page.getByRole("contentinfo").getByRole("link", { name: "KanjiVG" }),
        ).toBeVisible();
      });
    });
  }
}

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("the characters are already written and the demo holds one frame", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("[data-intro]")).toHaveAttribute(
      "data-intro",
      "done",
    );
    await expect(page.getByRole("button", { name: /Replay/ })).toHaveCount(0);
    const demo = page.locator("[data-frame]");
    const frame = await demo.getAttribute("data-frame");
    await page.waitForTimeout(4_000);
    await expect(demo).toHaveAttribute("data-frame", frame!);
    await expect(page.getByRole("button", { name: /demo/ })).toHaveCount(0);
  });
});

test("How it works scrolls to the three things", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "How it works" }).click();
  await expect(page).toHaveURL(/#usage$/);
  await expect(
    page.getByRole("heading", { name: /Three things/ }),
  ).toBeInViewport();
});
