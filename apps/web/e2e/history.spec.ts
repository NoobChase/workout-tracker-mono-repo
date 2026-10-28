import { expect, test } from "@playwright/test";
import { EXERCISE_IDS, FakeApi } from "./support/fake-api.js";
import { signIn } from "./support/session.js";
import { figures, live, logSet } from "./support/workout.js";

/*
 * Task 8.3: history. A workout finished through the UI appears with its
 * counted sets, and opens to every set with the unit it was logged in;
 * skipped exercises are marked. The API is faked in the browser.
 */

const BENCH = "Barbell Bench Press";
const OHP = "Overhead Press";

test("a finished session appears in history with its counted sets, units and skipped exercises", async ({
  page,
}) => {
  // LB by default; Overhead Press is set to KG for this user.
  const api = new FakeApi({
    units: { default: "LB", overrides: { [EXERCISE_IDS[OHP]!]: "KG" } },
  });
  api.startTemplate("push-pull-legs");
  await api.install(page);
  await signIn(page);

  await page.getByRole("button", { name: "Start Push" }).click();
  await logSet(page, BENCH, { weight: 185, reps: 8 });
  await logSet(page, BENCH, { reps: 7 });
  await live(page, BENCH)
    .getByRole("button", { name: `Next: ${OHP}` })
    .click();
  // The override reaches the stepper: this exercise is entered in kg.
  await expect(
    live(page, OHP).getByRole("button", { name: "Increase weight by 2.5 kg" }),
  ).toBeVisible();
  await logSet(page, OHP, { weight: 50, reps: 8 });
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Finish workout" })
    .click();
  await expect(page.getByRole("button", { name: "Start Pull" })).toBeVisible();

  await page.getByRole("link", { name: "History" }).click();
  const entry = page
    .getByRole("list", { name: "Finished workouts" })
    .getByRole("link");
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText("Push");
  await expect(entry).toContainText("Push Pull Legs · Cycle 1");
  await expect(entry).toContainText("3 sets");

  await entry.click();
  await expect(
    page.getByRole("heading", { name: "Push", level: 1 }),
  ).toBeVisible();
  const bench = page.getByRole("list", { name: `${BENCH} sets` });
  await expect(bench.getByRole("listitem")).toHaveCount(2);
  await expect(bench.getByRole("listitem").nth(0)).toContainText(
    figures(185, "lb", 8),
  );
  await expect(bench.getByRole("listitem").nth(1)).toContainText(
    figures(185, "lb", 7),
  );
  await expect(
    page.getByRole("list", { name: `${OHP} sets` }).getByRole("listitem"),
  ).toContainText(figures(50, "kg", 8));
  // The three exercises never touched read as skipped.
  await expect(page.getByText("Skipped", { exact: true })).toHaveCount(3);
});

test("history pages through older sessions with no repeats", async ({
  page,
}) => {
  const api = new FakeApi({ historyPageSize: 2 });
  api.startTemplate("push-pull-legs");
  api.seedFinished(api.workout("Push").id, "2026-10-20T13:00:00.000Z", {
    [BENCH]: [[225, 5]],
  });
  api.seedFinished(api.workout("Pull").id, "2026-10-21T13:00:00.000Z", {
    "Barbell Row": [
      [155, 8],
      [155, 8],
    ],
  });
  api.seedFinished(api.workout("Legs").id, "2026-10-22T13:00:00.000Z", {
    "Back Squat": [
      [275, 5],
      [275, 5],
      [275, 5],
    ],
  });
  await api.install(page);
  await signIn(page, "/");
  await page.getByRole("link", { name: "History" }).click();

  const entries = page
    .getByRole("list", { name: "Finished workouts" })
    .getByRole("link");
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(0)).toContainText("Legs");
  await expect(entries.nth(0)).toContainText("3 sets");
  await expect(entries.nth(1)).toContainText("Pull");

  await page.getByRole("button", { name: "Show older workouts" }).click();
  await expect(entries).toHaveCount(3);
  await expect(entries.nth(2)).toContainText("Push");
  await expect(entries.nth(2)).toContainText("1 set");
  await expect(
    page.getByRole("button", { name: "Show older workouts" }),
  ).toBeHidden();
});

test("offline, history says what it can't load", async ({ page, context }) => {
  const api = new FakeApi();
  api.startTemplate("push-pull-legs");
  api.seedFinished(api.workout("Push").id, "2026-10-20T13:00:00.000Z", {
    [BENCH]: [[225, 5]],
  });
  await api.install(page);
  await signIn(page);
  // Home loaded recent workouts online; offline, home and history say so.
  await expect(
    page.getByRole("list", { name: "Recent workouts" }).getByRole("link"),
  ).toHaveCount(1);
  await context.setOffline(true);
  await page.getByRole("link", { name: "History" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "This is what loaded earlier" }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Finished workouts" }).getByRole("link"),
  ).toHaveCount(1);
  // A session never opened online can't be loaded now.
  await page
    .getByRole("list", { name: "Finished workouts" })
    .getByRole("link")
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "This workout loads with a connection" }),
  ).toBeVisible();
});
