import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./support/fake-api.js";
import { signIn } from "./support/session.js";
import {
  figures,
  live,
  logSet,
  rows,
  setButton,
  syncLine,
} from "./support/workout.js";

/*
 * Task 8.2: the workout-sessions scenarios, through the UI. The API is
 * faked in the browser (support/fake-api.ts); sign-in is the real Clerk
 * development instance. Assertions check both the screen and the rows the
 * fake server ended with.
 */

const BENCH = "Barbell Bench Press";
const OHP = "Overhead Press";
const INCLINE = "Incline Dumbbell Bench Press";

/** Push Pull Legs, one cycle done: Push in cycle 2 is next, bench last at 225 × 5. */
function secondTimeThrough() {
  const api = new FakeApi();
  api.startTemplate("push-pull-legs");
  api.seedFinished(api.workout("Push").id, "2026-10-20T13:00:00.000Z", {
    [BENCH]: [
      [225, 5],
      [225, 5],
      [225, 4],
    ],
  });
  api.seedFinished(api.workout("Pull").id, "2026-10-21T13:00:00.000Z", {});
  api.seedFinished(api.workout("Legs").id, "2026-10-22T13:00:00.000Z", {});
  return api;
}

async function startPush(page: Page, api: FakeApi) {
  await api.install(page);
  await signIn(page);
  await expect(page.getByText(/Push Pull Legs · Cycle 2/)).toBeVisible();
  await page.getByRole("button", { name: "Start Push" }).click();
  await expect(live(page, BENCH)).toBeVisible();
  const workoutId = api.workout("Push", 2).id;
  await expect.poll(() => api.sessionOf(workoutId)?.status).toBe("IN_PROGRESS");
  return api.sessionOf(workoutId)!.id;
}

test("logs sets beside last time, past the target, then edits, deletes and finishes short", async ({
  page,
}) => {
  const api = secondTimeThrough();
  const sessionId = await startPush(page, api);
  const bench = live(page, BENCH);

  // Last time's numbers, and the steppers seeded from them and the plan.
  await expect(bench).toContainText(figures(225, "lb", 5));
  await expect(bench.getByRole("spinbutton", { name: "Weight" })).toHaveValue(
    "225",
  );
  await expect(bench.getByRole("spinbutton", { name: "Reps" })).toHaveValue(
    "5",
  );
  await expect(bench).toContainText("Set 1 / 3");

  // Three sets to the target, then a fourth: the target is not a limit.
  await logSet(page, BENCH);
  await logSet(page, BENCH, { reps: 6 });
  // Each set's reps reseed, never below the plan's floor: last time's set 3
  // was 225 × 4, under the 5–8 plan, so set 3 seeds 5, not 4 (and not the 6
  // just typed); the weight carries over from the last set.
  await expect(bench.getByRole("spinbutton", { name: "Reps" })).toHaveValue(
    "5",
  );
  await expect(bench.getByRole("spinbutton", { name: "Weight" })).toHaveValue(
    "225",
  );
  await logSet(page, BENCH, { reps: 5 });
  await expect(bench).toContainText("Set 4 · extra");
  await logSet(page, BENCH, { weight: 205, reps: 8 });
  await expect(syncLine(page)).toHaveText("All sets synced");
  await expect
    .poll(() => api.setsOf(sessionId)[BENCH])
    .toEqual([
      [1, 225, "LB", 5],
      [2, 225, "LB", 6],
      [3, 225, "LB", 5],
      [4, 205, "LB", 8],
    ]);

  // Correct set 2's reps from 6 to 4; nothing else changes.
  await setButton(page, BENCH, 2).click();
  const sheet = page.getByRole("dialog", { name: `Set 2 of ${BENCH}` });
  await sheet.getByRole("button", { name: "Decrease reps by 1" }).click();
  await sheet.getByRole("button", { name: "Decrease reps by 1" }).click();
  await sheet.getByRole("button", { name: "Save set 2" }).click();
  await expect(sheet).toBeHidden();
  await expect(rows(page, BENCH).nth(1)).toContainText(figures(225, "lb", 4));
  await expect(syncLine(page)).toHaveText("All sets synced");
  await expect
    .poll(() => api.setsOf(sessionId)[BENCH])
    .toEqual([
      [1, 225, "LB", 5],
      [2, 225, "LB", 4],
      [3, 225, "LB", 5],
      [4, 205, "LB", 8],
    ]);

  // Delete the middle set: the survivors renumber 1, 2, 3 in order.
  await setButton(page, BENCH, 2).click();
  await sheet.getByRole("button", { name: "Delete set 2" }).click();
  await expect(sheet).toContainText("Sets 3, 4 become 2, 3.");
  await sheet.getByRole("button", { name: "Delete set 2" }).click();
  await expect(sheet).toBeHidden();
  await expect(syncLine(page)).toHaveText("All sets synced");
  await expect
    .poll(() => api.setsOf(sessionId)[BENCH])
    .toEqual([
      [1, 225, "LB", 5],
      [2, 225, "LB", 5],
      [3, 205, "LB", 8],
    ]);
  await expect(
    rows(page, BENCH).filter({ has: page.getByRole("button") }),
  ).toHaveCount(3);

  // Skip Overhead Press: moving on writes nothing.
  await bench.getByRole("button", { name: `Next: ${OHP}` }).click();
  const writes = api.writes.length;
  await live(page, OHP)
    .getByRole("button", { name: `Skip to ${INCLINE}` })
    .click();
  await expect(live(page, INCLINE)).toBeVisible();
  expect(api.writes.length).toBe(writes);

  // First time on an exercise: no last time, and the weight starts empty.
  const incline = live(page, INCLINE);
  await expect(incline).toContainText("First time; no numbers yet");
  await expect(incline.getByRole("spinbutton", { name: "Weight" })).toHaveValue(
    "",
  );
  await incline.getByRole("button", { name: "Log set" }).click();
  await expect(incline.getByRole("alert")).toContainText(
    "Enter the weight first",
  );
  expect(api.writes.length).toBe(writes);
  await logSet(page, INCLINE, { weight: 55 });

  // Stop short: finish with sets left; exactly the logged rows exist.
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Finish with 11 sets left?",
  });
  await expect(dialog).toContainText("4 of 15 planned sets are logged.");
  await dialog.getByRole("button", { name: "Finish workout" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("Push finished")).toBeVisible();
  await expect
    .poll(() => api.sessions.get(sessionId)?.status)
    .toBe("COMPLETED");
  await expect
    .poll(() => api.setsOf(sessionId))
    .toEqual({
      [BENCH]: [
        [1, 225, "LB", 5],
        [2, 225, "LB", 5],
        [3, 205, "LB", 8],
      ],
      [INCLINE]: [[1, 55, "LB", 8]],
    });
  // Mid-cycle: what's next moves to Pull in the same cycle.
  await expect(page.getByRole("button", { name: "Start Pull" })).toBeVisible();
});

test("deleting an exercise's only set reads as skipped", async ({ page }) => {
  const api = secondTimeThrough();
  const sessionId = await startPush(page, api);

  await logSet(page, BENCH);
  await setButton(page, BENCH, 1).click();
  const sheet = page.getByRole("dialog", { name: `Set 1 of ${BENCH}` });
  await sheet.getByRole("button", { name: "Delete set 1" }).click();
  await expect(sheet).toContainText("It’s the only one");
  await sheet.getByRole("button", { name: "Delete set 1" }).click();
  await expect(sheet).toBeHidden();
  // Poll the server: the line may still read "synced" from the log before
  // the delete is queued.
  await expect.poll(() => api.setsOf(sessionId)).toEqual({});
  await expect(syncLine(page)).toHaveText("All sets synced");

  await live(page, BENCH)
    .getByRole("button", { name: `Skip to ${OHP}` })
    .click();
  await expect(
    page.getByRole("button", { name: new RegExp(`^${BENCH}`) }),
  ).toContainText("skipped");
});

test("offline: the start and the sets queue, the line counts sets, and they sync in order", async ({
  page,
  context,
}) => {
  const api = secondTimeThrough();
  await api.install(page);
  await signIn(page);
  await expect(
    page.getByRole("list", { name: "Push exercises" }),
  ).toBeVisible();
  // The prefetch has stored Push's plan; now the signal drops.
  await context.setOffline(true);
  await expect(syncLine(page)).toHaveText("No signal, sets will queue");

  await page.getByRole("button", { name: "Start Push" }).click();
  await expect(live(page, BENCH)).toContainText(figures(225, "lb", 5));
  await expect(syncLine(page)).toHaveText("Workout queued, no signal");
  await logSet(page, BENCH);
  await logSet(page, BENCH);
  await expect(syncLine(page)).toHaveText("2 sets queued, no signal");
  await expect(rows(page, BENCH).first()).toContainText("queued, no signal");
  expect(api.writes).toEqual([]);

  await context.setOffline(false);
  await expect(syncLine(page)).toHaveText("All sets synced", {
    timeout: 20_000,
  });
  await expect(rows(page, BENCH).first()).toContainText("logged");
  expect(api.writes.map((w) => w.split(" ")[0])).toEqual(["PUT", "PUT", "PUT"]);
  expect(api.writes[0]).toMatch(/^PUT \/api\/sessions\//);
});

const LAPSED = "Your trial has ended, so new sets can’t be saved.";

test("a not-entitled rejection stops the queue, says so honestly, and goes through on retry", async ({
  page,
}) => {
  const api = secondTimeThrough();
  await startPush(page, api);
  api.rejectStatus = 403;
  api.rejectSet = () => LAPSED;

  await logSet(page, BENCH);
  await expect(syncLine(page)).toHaveText(
    "A set was rejected, its workout stopped syncing",
  );
  const band = page.getByRole("alert").filter({ hasText: "wasn’t saved" });
  await expect(band).toContainText(`Set 1 of ${BENCH} wasn’t saved: ${LAPSED}`);
  // Not entitled: no pretend Subscribe control, just what's true today.
  await expect(band).toContainText(
    "Subscribing comes with billing, which isn’t here yet.",
  );
  // One lane per workout: the band names the workout that waits.
  await expect(band).toContainText(
    "until then the rest of Push stays on this device.",
  );
  await expect(band.getByRole("link", { name: /subscribe/i })).toHaveCount(0);
  await expect(band.getByRole("button", { name: /subscribe/i })).toHaveCount(0);
  await expect(rows(page, BENCH).first()).toContainText("rejected");
  await expect(rows(page, BENCH).first()).toContainText(LAPSED);

  // A later set waits behind it, seeded from the last set not refused.
  await logSet(page, BENCH);
  await expect(rows(page, BENCH).nth(1)).toContainText("queued, in order");

  // Try again leads; a plain link shows the set.
  await expect(band.getByRole("button").first()).toHaveText("Try again");
  await band.getByRole("link", { name: "Show set" }).click();
  await expect(page).toHaveURL(/[?&]set=/);
  await expect(band.getByRole("link", { name: "Show set" })).toHaveCount(0);

  // The account is in order again; retrying sends it, and the one behind.
  api.rejectSet = null;
  await band.getByRole("button", { name: "Try again" }).click();
  await expect(syncLine(page)).toHaveText("All sets synced");
  await expect(band).toBeHidden();
  await expect
    .poll(
      () =>
        Object.values(
          api.setsOf(api.sessionOf(api.workout("Push", 2).id)!.id),
        )[0],
    )
    .toEqual([
      [1, 225, "LB", 5],
      [2, 225, "LB", 5],
    ]);
});
