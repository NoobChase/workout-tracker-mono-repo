import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./support/fake-api/router.js";
import { signIn } from "./support/session.js";
import { syncLine } from "./support/workout.js";

/*
 * Task 8.1: skipping a whole workout from home (spec `workout-sessions`,
 * design D15). Skip is a queued write in its own lane, like a start: the
 * device treats the skipped workout as resolved at once, and the server
 * rolls the program over when the skip arrives.
 */

function nextCard(page: Page, workout: string) {
  return page
    .getByRole("heading", { name: workout, level: 2, exact: true })
    .locator("xpath=ancestor::*[@data-slot='card'][1]");
}

async function skip(page: Page, workout: string, movesUp: string | RegExp) {
  await page.getByRole("button", { name: `Skip ${workout}` }).click();
  const prompt = page.getByRole("group", {
    name: new RegExp(`^Skip ${workout}\\?`),
  });
  await expect(prompt).toContainText(movesUp);
  // The confirmation takes focus, so a second tap (or Enter) confirms.
  await expect(
    prompt.getByRole("button", { name: `Skip ${workout}` }),
  ).toBeFocused();
  await prompt.getByRole("button", { name: `Skip ${workout}` }).click();
}

test("skipping Legs after a hike: a one-tap confirmation naming what moves up, one SKIPPED session, and the cycle's last skip rolls the program over", async ({
  page,
}) => {
  const api = new FakeApi();
  const program = api.startTemplate("push-pull-legs");
  await api.install(page);
  await signIn(page);

  // "Keep it" backs out and writes nothing.
  await page.getByRole("button", { name: "Skip Push" }).click();
  await page.getByRole("button", { name: "Keep it" }).click();
  await expect(page.getByRole("button", { name: "Skip Push" })).toBeFocused();
  expect(api.writes).toEqual([]);

  await skip(page, "Push", "Pull moves up next.");
  await expect(nextCard(page, "Pull")).toContainText(
    "Push Pull Legs · Cycle 1",
  );
  await expect(page.getByRole("button", { name: "Start Push" })).toHaveCount(0);
  const push = api.workout("Push", 1, program.id);
  await expect.poll(() => api.sessionOf(push.id)?.status).toBe("SKIPPED");
  expect(api.writes).toEqual([`POST /api/workouts/${push.id}/skip`]);
  // One row and nothing else: no sets, nothing in history.
  expect(api.sets.size).toBe(0);
  await expect(
    page.getByText("Finished workouts land here, newest first."),
  ).toBeVisible();

  await skip(page, "Pull", "Legs moves up next.");
  await expect(nextCard(page, "Legs")).toBeVisible();

  // spec workout-sessions, "Skipping the cycle's last workout": the program
  // gains cycle 2 and what's next shows its first workout.
  await skip(page, "Legs", "Cycle 2 starts next, with Push.");
  await expect(nextCard(page, "Push")).toContainText(
    "Push Pull Legs · Cycle 2",
    {
      timeout: 15_000,
    },
  );
  expect(api.cycleOf(program.id, 2).map((w) => w.name)).toEqual([
    "Push",
    "Pull",
    "Legs",
  ]);
});

test("skipping offline: home moves on at once, and the skips reach the server in order when signal returns", async ({
  page,
  context,
}) => {
  const api = new FakeApi();
  const program = api.startTemplate("push-pull-legs");
  await api.install(page);
  await signIn(page);
  await expect(nextCard(page, "Push")).toContainText("5 exercises");
  // Let the outline and the following workout's plan reach the device.
  await page.waitForLoadState("networkidle");

  await context.setOffline(true);
  await skip(page, "Push", "Pull moves up next.");
  await expect(nextCard(page, "Pull")).toBeVisible();
  // The following workout's plan was prefetched: it previews offline.
  await expect(nextCard(page, "Pull")).toContainText(
    "5 exercises · Barbell Row",
  );
  await skip(page, "Pull", "Legs moves up next.");
  await expect(nextCard(page, "Legs")).toBeVisible();
  await expect(syncLine(page)).toHaveText("Workout queued, no signal");
  expect(api.writes).toEqual([]);

  await context.setOffline(false);
  await expect(syncLine(page)).toHaveText("All sets synced", {
    timeout: 60_000,
  });
  const push = api.workout("Push", 1, program.id).id;
  const pull = api.workout("Pull", 1, program.id).id;
  expect(api.writes).toEqual([
    `POST /api/workouts/${push}/skip`,
    `POST /api/workouts/${pull}/skip`,
  ]);
  expect(api.sessionOf(push)?.status).toBe("SKIPPED");
  expect(api.sessionOf(pull)?.status).toBe("SKIPPED");
  await expect(nextCard(page, "Legs")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start Legs" })).toBeVisible();
});
