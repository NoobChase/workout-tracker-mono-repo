import { expect, test, type Page } from "@playwright/test";

const BG = { light: "rgb(244, 241, 236)", dark: "rgb(19, 18, 16)" } as const;

/** The kit's working live set, not the specimens below it. */
function liveSet(page: Page) {
  return page.getByRole("region", { name: "Back Squat" });
}

/** The demo's log, its sync status and the signal/sync simulation. */
function todaysLog(page: Page) {
  return page.getByRole("region", { name: "Today’s log" });
}

function setRows(page: Page) {
  return page
    .getByRole("list", { name: "Back Squat sets" })
    .getByRole("listitem");
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} color scheme`, () => {
    test.use({ colorScheme });

    test("follows the device and logs a set into the log", async ({ page }) => {
      await page.goto("/design");
      await expect(page).toHaveTitle("Tanren");
      expect(
        await page.evaluate(
          () => getComputedStyle(document.body).backgroundColor,
        ),
      ).toBe(BG[colorScheme]);
      // The pinned panes ignore the device: one light, one dark, always.
      for (const pane of ["light", "dark"] as const) {
        const bg = await page
          .getByRole("region", {
            name: `${pane === "light" ? "Light" : "Dark"} theme`,
          })
          .evaluate((el) => getComputedStyle(el).backgroundColor);
        expect(bg).toBe(BG[pane]);
      }

      const third = setRows(page).nth(2);
      await expect(third).toHaveAttribute("data-status", "live");
      await expect(liveSet(page)).toContainText("Set 3 / 5");

      await liveSet(page)
        .getByRole("button", { name: "Increase weight by 5 lb" })
        .click();
      await expect(
        liveSet(page).getByRole("spinbutton", { name: "Weight" }),
      ).toHaveValue("230");
      await liveSet(page).getByRole("button", { name: "Log set" }).click();

      await expect(third).toHaveAttribute("data-status", "logged");
      await expect(third).toContainText("230");
      await expect(third).toContainText("logged");
      await expect(setRows(page).nth(3)).toHaveAttribute("data-status", "live");
      await expect(liveSet(page)).toContainText("Set 4 / 5");
      await expect(
        todaysLog(page)
          .getByRole("status")
          .filter({ hasText: "All sets synced" }),
      ).toBeVisible();
    });
  });
}

test("offline, a logged set queues and then syncs when the signal returns", async ({
  page,
}) => {
  await page.goto("/design");
  await todaysLog(page)
    .getByRole("button", { name: "Offline", exact: true })
    .click();
  await liveSet(page).getByRole("button", { name: "Log set" }).click();

  const third = setRows(page).nth(2);
  await expect(third).toHaveAttribute("data-status", "queued");
  await expect(third).toContainText("queued, no signal");
  await expect(
    todaysLog(page)
      .getByRole("status")
      .filter({ hasText: "1 set queued, no signal" }),
  ).toBeVisible();

  await todaysLog(page)
    .getByRole("button", { name: "Online", exact: true })
    .click();
  await expect(third).toHaveAttribute("data-status", "logged");
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "1 set synced" }),
  ).toBeVisible();
});

test("a failing sync shows the set as retrying until it lands", async ({
  page,
}) => {
  await page.goto("/design");
  await todaysLog(page)
    .getByRole("button", { name: "Fail", exact: true })
    .click();
  await liveSet(page).getByRole("button", { name: "Log set" }).click();

  const third = setRows(page).nth(2);
  await expect(third).toHaveAttribute("data-status", "failed");
  await expect(third).toContainText("failed, retrying");
  await expect(
    todaysLog(page)
      .getByRole("status")
      .filter({ hasText: "1 set failed, retrying" }),
  ).toBeVisible();

  await todaysLog(page)
    .getByRole("button", { name: "Succeed", exact: true })
    .click();
  await expect(third).toHaveAttribute("data-status", "logged");
});

/**
 * Records every set row's status change, in order, as "n:status", so a test
 * can check the order the queue delivered in, not just where it ended up.
 */
async function recordStatuses(page: Page) {
  await page.getByRole("list", { name: "Back Squat sets" }).evaluate((list) => {
    const seen: string[] = [];
    (window as unknown as { statuses: string[] }).statuses = seen;
    new MutationObserver((records) => {
      for (const record of records) {
        const row = record.target as HTMLElement;
        const n = Array.from(list.children).indexOf(row) + 1;
        seen.push(`${n}:${row.dataset.status}`);
      }
    }).observe(list, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-status"],
    });
  });
  return async () =>
    page.evaluate(() => (window as unknown as { statuses: string[] }).statuses);
}

const deliveredInOrder = (statuses: string[]) =>
  statuses.filter((s) => s.endsWith(":logged"));

test("a set logged behind a waiting one queues, and they deliver in order", async ({
  page,
}) => {
  await page.goto("/design");
  const statuses = await recordStatuses(page);
  await todaysLog(page)
    .getByRole("button", { name: "Offline", exact: true })
    .click();
  await liveSet(page).getByRole("button", { name: "Log set" }).click();
  await todaysLog(page)
    .getByRole("button", { name: "Online", exact: true })
    .click();
  // Signal is back but set 3 hasn't gone yet: set 4 must wait behind it.
  await liveSet(page).getByRole("button", { name: "Log set" }).click();

  const rows = setRows(page);
  await expect(rows.nth(3)).toHaveAttribute("data-status", "queued");
  await expect(rows.nth(3)).toContainText("queued, in order");
  await expect(rows.nth(3)).toHaveAttribute("data-status", "logged");
  await expect(rows.nth(2)).toHaveAttribute("data-status", "logged");
  await expect(rows.nth(4)).toHaveAttribute("data-status", "live");
  expect(deliveredInOrder(await statuses())).toEqual(["3:logged", "4:logged"]);
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "2 sets synced" }),
  ).toBeVisible();
});

test("a set logged behind a failed one queues, and both deliver in order once sends succeed", async ({
  page,
}) => {
  await page.goto("/design");
  const statuses = await recordStatuses(page);
  await todaysLog(page)
    .getByRole("button", { name: "Fail", exact: true })
    .click();
  await liveSet(page).getByRole("button", { name: "Log set" }).click();
  const rows = setRows(page);
  await expect(rows.nth(2)).toHaveAttribute("data-status", "failed");

  await todaysLog(page)
    .getByRole("button", { name: "Succeed", exact: true })
    .click();
  await liveSet(page).getByRole("button", { name: "Log set" }).click();
  await expect(rows.nth(3)).toHaveAttribute("data-status", "queued");

  await expect(rows.nth(3)).toHaveAttribute("data-status", "logged");
  await expect(rows.nth(2)).toHaveAttribute("data-status", "logged");
  expect(deliveredInOrder(await statuses())).toEqual(["3:logged", "4:logged"]);
});

test("a failing send keeps retrying with backoff, and recovers without a new log", async ({
  page,
}) => {
  await page.goto("/design");
  await todaysLog(page)
    .getByRole("button", { name: "Fail", exact: true })
    .click();
  await liveSet(page).getByRole("button", { name: "Log set" }).click();
  const third = setRows(page).nth(2);
  await expect(third).toHaveAttribute("data-status", "failed");
  await expect(todaysLog(page)).toHaveAttribute("data-send-attempts", "1");

  // Retries continue while sends fail: 1.4s, then 2.8s later.
  await expect(todaysLog(page)).toHaveAttribute("data-send-attempts", "2", {
    timeout: 3_000,
  });
  await expect(todaysLog(page)).toHaveAttribute("data-send-attempts", "3", {
    timeout: 4_000,
  });
  await expect(third).toHaveAttribute("data-status", "failed");

  await todaysLog(page)
    .getByRole("button", { name: "Succeed", exact: true })
    .click();
  await expect(third).toHaveAttribute("data-status", "logged");
  await expect(
    todaysLog(page).getByRole("status").filter({ hasText: "All sets synced" }),
  ).toBeVisible();
});

test("logging rules the set in once, within 240ms", async ({ page }) => {
  await page.goto("/design");
  await liveSet(page).getByRole("button", { name: "Log set" }).click();
  const timings = await setRows(page)
    .nth(2)
    .evaluate((row) =>
      row
        .getAnimations({ subtree: true })
        .map((a) => a.effect?.getTiming().duration),
    );
  expect(timings.length).toBeGreaterThan(0);
  for (const duration of timings) expect(duration).toBeLessThanOrEqual(240);
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("logging moves nothing", async ({ page }) => {
    await page.goto("/design");
    await liveSet(page).getByRole("button", { name: "Log set" }).click();
    const third = setRows(page).nth(2);
    await expect(third).toHaveAttribute("data-status", "logged");
    expect(
      await third.evaluate(
        (row) => row.getAnimations({ subtree: true }).length,
      ),
    ).toBe(0);
  });
});

test("the theme toggle flips the page and is remembered", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/design");
  await page
    .getByRole("banner")
    .getByRole("button", { name: "Light theme, switch to dark" })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(
    await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
  ).toBe(BG.dark);
});
