import { expect, test } from "@playwright/test";
import { FakeApi } from "./support/fake-api.js";
import { signInHere } from "./support/session.js";
import {
  figures,
  live,
  logSet,
  rows,
  setButton,
  syncLine,
} from "./support/workout.js";

/*
 * Task 10.2: the step 3 goal, offline, against a production build with its
 * service worker (the `preview` project in playwright.config.ts). The API is
 * faked for the whole browser context, the service worker's requests
 * included; sign-in is the real Clerk development instance.
 */

const BENCH = "Barbell Bench Press";

test("offline: start, log three, delete one, finish, reload offline, then sync in order to history", async ({
  page,
  context,
}) => {
  const api = new FakeApi();
  api.startTemplate("push-pull-legs");
  await api.install(context);

  // First visit installs the service worker; a reload puts the page under it.
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  expect(
    await page.evaluate(() => navigator.serviceWorker.controller !== null),
  ).toBe(true);

  // Online: sign in, and what's next loads with Push's plan prefetched.
  await signInHere(page);
  await expect(
    page.getByRole("list", { name: "Push exercises" }),
  ).toBeVisible();
  expect(api.writes).toEqual([]);

  // Airplane mode for the whole workout.
  await context.setOffline(true);
  await page.getByRole("button", { name: "Start Push" }).click();
  await expect(live(page, BENCH)).toBeVisible();
  const sessionPath = new URL(page.url()).pathname;
  const sessionId = sessionPath.split("/").pop()!;

  await logSet(page, BENCH, { weight: 135, reps: 8 });
  await logSet(page, BENCH, { weight: 145, reps: 6 });
  await logSet(page, BENCH, { weight: 155, reps: 4 });
  await setButton(page, BENCH, 2).click();
  const sheet = page.getByRole("dialog", { name: `Set 2 of ${BENCH}` });
  await sheet.getByRole("button", { name: "Delete set 2" }).click();
  await sheet.getByRole("button", { name: "Delete set 2" }).click();
  await expect(sheet).toBeHidden();
  await expect(rows(page, BENCH).nth(1)).toContainText(figures(155, "lb", 4));

  await page.getByRole("button", { name: "Finish", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Finish workout" })
    .click();
  await expect(page).toHaveURL(/\/$/);
  // Three sets touched; the start and finish wait with them.
  await expect(syncLine(page)).toHaveText("3 sets queued, no signal");
  expect(api.writes).toEqual([]);

  // Reload with no signal: the shell comes from the service worker and the
  // record and queue from IndexedDB, without waiting for Clerk.
  await page.reload();
  await expect(page.getByRole("link", { name: "Tanren, home" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(syncLine(page)).toHaveText("3 sets queued, no signal");
  await page.goto(sessionPath);
  await expect(
    page.getByText("Finished. It moves to history once it has synced."),
  ).toBeVisible();
  await expect(rows(page, BENCH)).toHaveCount(2);
  await expect(rows(page, BENCH).nth(0)).toContainText(figures(135, "lb", 8));
  await expect(rows(page, BENCH).nth(1)).toContainText(figures(155, "lb", 4));
  expect(api.writes).toEqual([]);

  // Signal returns: the queue drains without a reload, in the order it was made.
  await context.setOffline(false);
  await expect(syncLine(page)).toHaveText("All sets synced", {
    timeout: 60_000,
  });
  const setIds = api.writes
    .filter((w) => w.startsWith("PUT /api/sets/"))
    .map((w) => w.split("/").pop()!);
  expect(setIds).toHaveLength(3);
  expect(api.writes).toEqual([
    `PUT /api/sessions/${sessionId}`,
    `PUT /api/sets/${setIds[0]}`,
    `PUT /api/sets/${setIds[1]}`,
    `PUT /api/sets/${setIds[2]}`,
    `DELETE /api/sets/${setIds[1]}`,
    `POST /api/sessions/${sessionId}/finish`,
  ]);
  expect(api.setsOf(sessionId)).toEqual({
    [BENCH]: [
      [1, 135, "LB", 8],
      [2, 155, "LB", 4],
    ],
  });

  // History shows it, with the renumbered sets.
  await page.goto("/history");
  const entry = page
    .getByRole("list", { name: "Finished workouts" })
    .getByRole("link");
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText("2 sets");
  await entry.click();
  const bench = page
    .getByRole("list", { name: `${BENCH} sets` })
    .getByRole("listitem");
  await expect(bench).toHaveCount(2);
  await expect(bench.nth(0)).toContainText(figures(135, "lb", 8));
  await expect(bench.nth(1)).toContainText(figures(155, "lb", 4));
});
