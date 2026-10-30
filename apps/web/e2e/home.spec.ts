import { expect, test } from "@playwright/test";
import { FakeApi } from "./support/fake-api/router.js";
import { signIn } from "./support/session.js";
import { logSet } from "./support/workout.js";

/*
 * Task 8.1: home (brief `apps-web-src-home`). The API is faked in the
 * browser (support/fake-api/); sign-in is the real Clerk development
 * instance.
 */

test("first run: create from scratch opens the builder and writes nothing; a template from the sheet starts a program", async ({
  page,
}) => {
  const api = new FakeApi();
  await api.install(page);
  await signIn(page);

  await expect(
    page.getByRole("heading", { name: "Start your first program" }),
  ).toBeVisible();
  // Header: the wordmark, then Programs and History.
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link")).toHaveText(["Programs", "History"]);

  // spec program-templates, "Choosing create from scratch".
  await page.getByRole("link", { name: "Create from scratch" }).click();
  await expect(page).toHaveURL(/\/programs\/new$/);
  await expect(
    page.getByRole("heading", { name: "New program" }),
  ).toBeVisible();
  expect(api.writes).toEqual([]);
  expect(api.programs).toEqual([]);

  await page.goBack();
  await page.getByRole("button", { name: "Pick a template" }).click();
  const sheet = page.getByRole("dialog", { name: "Start from a template" });
  await expect(
    sheet.getByText(/Barbell Bench Press, Overhead Press/).first(),
  ).toBeVisible();
  await sheet.getByRole("button", { name: "Start Push Pull Legs" }).click();
  await expect(sheet).toBeHidden();

  await expect(
    page.getByRole("heading", { name: "What’s next" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Start Push" })).toBeVisible();
  await expect(page.getByText("Push Pull Legs · Cycle 1")).toBeVisible();
  // The prefetched plan previews the workout: a count and a one-line list.
  await expect(
    page.getByText(/5 exercises · Barbell Bench Press/),
  ).toBeVisible();
  // Your programs lists it with its status and progress.
  const yours = page.getByRole("list", { name: "Your programs" });
  await expect(yours.getByRole("link")).toHaveText([
    /Push Pull Legs\s*Active · Cycle 1/,
  ]);
  expect(api.writes).toEqual(["POST /api/programs/from-template"]);

  await page.getByRole("button", { name: "Start Push" }).click();
  await expect(page).toHaveURL(/\/workout\//);
  await expect(
    page.getByRole("heading", { name: "Barbell Bench Press", level: 2 }),
  ).toBeVisible();
});

test("an unfinished workout comes first, with Continue and Finish & start next, never Skip", async ({
  page,
}) => {
  const api = new FakeApi();
  api.startTemplate("push-pull-legs");
  await api.install(page);
  await signIn(page);

  await page.getByRole("button", { name: "Start Push" }).click();
  await logSet(page, "Barbell Bench Press", { weight: 135, reps: 8 });
  await logSet(page, "Barbell Bench Press", { weight: 135, reps: 8 });

  await page.reload();
  await page.getByRole("link", { name: "Tanren, home" }).click();
  // spec workout-sessions, "Started workouts are not skippable".
  const resume = page.getByRole("button", { name: "Continue Push" });
  await expect(resume).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Finish & start next" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Start Push" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Skip Push" })).toHaveCount(0);
  await expect(
    page.getByText(/Started today,.*1 of 5 exercises logged/),
  ).toBeVisible();
  await resume.click();
  const rows = page
    .getByRole("list", { name: "Barbell Bench Press sets" })
    .getByRole("listitem");
  await expect(rows.filter({ hasText: "logged" })).toHaveCount(2);
});

test("Finish & start next finishes yesterday's workout with its sets and opens the program's next", async ({
  page,
}) => {
  const api = new FakeApi();
  const program = api.startTemplate("push-pull-legs");
  await api.install(page);
  await signIn(page);

  await page.getByRole("button", { name: "Start Push" }).click();
  await logSet(page, "Barbell Bench Press", { weight: 135, reps: 8 });
  const push = new URL(page.url()).pathname.split("/").pop()!;
  await page.getByRole("link", { name: "Tanren, home" }).click();

  await page.getByRole("button", { name: "Finish & start next" }).click();
  await expect(page).toHaveURL(/\/workout\//);
  await expect(
    page.getByRole("heading", { name: "Barbell Row", level: 2 }),
  ).toBeVisible();
  const pull = new URL(page.url()).pathname.split("/").pop()!;
  expect(pull).not.toBe(push);

  // The finish is queued before the start, and both reach the server.
  await expect
    .poll(() => api.writes.filter((w) => !w.startsWith("PUT /api/sets")))
    .toEqual([
      `PUT /api/sessions/${push}`,
      `POST /api/sessions/${push}/finish`,
      `PUT /api/sessions/${pull}`,
    ]);
  expect(api.sessions.get(push)?.status).toBe("COMPLETED");
  expect(api.setsOf(push)).toEqual({
    "Barbell Bench Press": [[1, 135, "LB", 8]],
  });
  expect(api.sessions.get(pull)).toMatchObject({
    workoutId: api.workout("Pull", 1, program.id).id,
    status: "IN_PROGRESS",
  });
});
