import { expect, test } from "@playwright/test";
import { FakeApi } from "./support/fake-api.js";
import { signIn } from "./support/session.js";

/*
 * Task 8.1: home. The API is faked in the browser (support/fake-api.ts);
 * sign-in is the real Clerk development instance.
 */

test("a fresh account sees the templates, starts one, and sees its first workout", async ({
  page,
}) => {
  const api = new FakeApi();
  await api.install(page);
  await signIn(page);

  await expect(
    page.getByRole("heading", { name: "Choose a program" }),
  ).toBeVisible();
  const ppl = page.getByRole("button", { name: "Start Push Pull Legs" });
  await expect(ppl).toBeVisible();
  // Each template names its workouts and their exercises.
  await expect(page.getByText("Push", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/Barbell Bench Press, Overhead Press/).first(),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText("All sets synced");

  // Create from scratch announces the builder and writes nothing.
  await page.getByRole("button", { name: "Create from scratch" }).click();
  await expect(page.getByText(/program builder is coming/)).toBeVisible();
  expect(api.writes).toEqual([]);

  await ppl.click();
  await expect(
    page.getByRole("heading", { name: "What’s next" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Start Push" })).toBeVisible();
  await expect(page.getByText(/Push Pull Legs · Cycle 1/)).toBeVisible();
  // The prefetched plan previews the workout's exercises.
  await expect(
    page.getByRole("list", { name: "Push exercises" }).getByRole("listitem"),
  ).toHaveCount(5);
  expect(api.programs.map((p) => p.name)).toEqual(["Push Pull Legs"]);
  expect(api.writes).toEqual(["POST /api/programs/from-template"]);

  await page.getByRole("button", { name: "Start Push" }).click();
  await expect(page).toHaveURL(/\/workout\//);
  await expect(
    page.getByRole("heading", { name: "Barbell Bench Press", level: 2 }),
  ).toBeVisible();
});

test("an in-progress workout is offered for resumption, and resuming shows its sets", async ({
  page,
}) => {
  const api = new FakeApi();
  api.startTemplate("push-pull-legs");
  await api.install(page);
  await signIn(page);

  await page.getByRole("button", { name: "Start Push" }).click();
  for (const weight of ["135", "135"]) {
    await page.getByRole("spinbutton", { name: "Weight" }).fill(weight);
    await page.getByRole("button", { name: "Log set" }).click();
  }
  await expect(
    page.getByRole("list", { name: "Barbell Bench Press sets" }),
  ).toContainText("logged");

  await page.reload();
  await page.getByRole("link", { name: "Tanren, home" }).click();
  // One action per session: the In progress card resumes; Push's
  // what's-next card says "in progress" and offers no second way in.
  const resume = page.getByRole("button", { name: "Resume Push" });
  await expect(resume).toHaveCount(1);
  await expect(page.getByText(/Cycle 1 · in progress/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Start Push" })).toHaveCount(0);
  await expect(page.getByText(/2 sets logged/)).toBeVisible();
  await resume.click();
  const rows = page
    .getByRole("list", { name: "Barbell Bench Press sets" })
    .getByRole("listitem");
  await expect(rows.filter({ hasText: "logged" })).toHaveCount(2);
});
