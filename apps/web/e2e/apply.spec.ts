import { expect, test, type Page } from "@playwright/test";
import { newId, type SaveCycleRequest } from "@workout-tracker/shared";
import { FakeApi } from "./support/fake-api/router.js";
import { signIn } from "./support/session.js";

/*
 * Task 9.2: the apply-to-cycles confirmation (operations.md 3.8; design D7)
 * against each apply scenario in `specs/program-builder`: pre-checks from
 * the preview, the "looks intentionally different" annotation, logged
 * cycles locked, the user's override, a stale choice refused with nothing
 * written and the draft kept, and a retried save writing once.
 */

function sheet(page: Page) {
  return page.getByRole("dialog", { name: "Apply to later cycles?" });
}

function box(page: Page, n: number) {
  return sheet(page)
    .getByRole("listitem")
    .filter({ hasText: new RegExp(`^Cycle ${n}(?!\\d)`) })
    .getByRole("checkbox");
}

/** Cycle n's Upper gets Face Pull, through the picker; then Save. */
async function addFacePullAndSave(page: Page, programId: string, n: number) {
  await page.goto(`/programs/${programId}/cycles/${n}`);
  await page
    .getByRole("region", { name: /^Workout 1:/ })
    .getByRole("button", { name: "Add exercise" })
    .click();
  const picker = page.getByRole("dialog", { name: /^Add to/ });
  await picker
    .getByRole("searchbox", { name: "Search exercises" })
    .fill("face");
  await picker.getByRole("button", { name: "Add Face Pull" }).click();
  await expect(picker).toBeHidden();
  await page.getByRole("button", { name: `Save cycle ${n}` }).click();
  await expect(sheet(page)).toBeVisible();
}

const hasFacePull = (api: FakeApi, programId: string, n: number) =>
  api
    .cycleOf(programId, n)[0]!
    .exercises.some((e) => e.exerciseId === api.exercise("Face Pull").id);

/** An authored deload: cycle n's squats at 100 lb. */
function deload(api: FakeApi, programId: string, n: number) {
  const squat = api.cycleOf(programId, n)[1]!.exercises[0]!;
  for (const s of squat.plannedSets) {
    s.targetWeight = 100;
    s.weightUnit = "LB";
  }
}

function saves(api: FakeApi) {
  return api.bodies.filter((_, i) =>
    api.writes[i]!.startsWith("PUT /api/programs/"),
  ) as SaveCycleRequest[];
}

test("add an exercise to the remaining cycles: matching ones pre-checked, an authored deload flagged and left alone, notes don't count", async ({
  page,
}) => {
  const api = new FakeApi();
  const program = api.addProgram({
    name: "Summer Strength",
    targetCycles: 12,
    resolvedThrough: 4,
  });
  deload(api, program.id, 9);
  api.cycleOf(program.id, 7)[0]!.notes = "Go easy on the shoulder";
  const deloadPrint = api.fingerprint(program.id, 9);
  await api.install(page);
  await signIn(page);

  await addFacePullAndSave(page, program.id, 5);
  await expect(sheet(page)).toContainText("Saving changes to cycle 5");
  // Every later cycle, one checkbox each; 1-4 are earlier, so not listed.
  await expect(sheet(page).getByRole("checkbox")).toHaveCount(7);
  for (const n of [6, 7, 8, 10, 11, 12])
    await expect(box(page, n)).toBeChecked();
  await expect(box(page, 9)).not.toBeChecked();
  const nine = sheet(page)
    .getByRole("listitem")
    .filter({ hasText: /^Cycle 9/ });
  await expect(nine).toContainText("looks intentionally different");
  await expect(
    sheet(page)
      .getByRole("listitem")
      .filter({ hasText: /^Cycle 7/ }),
  ).not.toContainText("different");

  await sheet(page)
    .getByRole("button", { name: "Save and apply to cycles 6–8, 10–12" })
    .click();
  await expect(
    page.getByText("Applied to cycles 6–8, 10–12 too."),
  ).toBeVisible();

  for (const n of [5, 6, 7, 8, 10, 11, 12])
    expect(hasFacePull(api, program.id, n)).toBe(true);
  for (const n of [1, 2, 3, 4, 9])
    expect(hasFacePull(api, program.id, n)).toBe(false);
  expect(api.fingerprint(program.id, 9)).toBe(deloadPrint);
  const [request] = saves(api);
  expect(
    request!.applyTo.map((t) => t.cycleNumber).sort((a, b) => a - b),
  ).toEqual([6, 7, 8, 10, 11, 12]);
});

test("a deload in cycle 9 changes only cycle 9; the lifter overrides the flag; a logged cycle is locked", async ({
  page,
}) => {
  const api = new FakeApi();
  const program = api.addProgram({ name: "Summer Strength", targetCycles: 12 });
  // Cycle 12 has a session under way: logged, so never an apply target.
  const s = newId();
  api.sessions.set(s, {
    id: s,
    workoutId: api.workout("Upper", 12, program.id).id,
    performedAt: "2026-10-28T13:00:00.000Z",
    status: "IN_PROGRESS",
  });
  await api.install(page);
  await signIn(page);

  // "Deload in cycle 9": lower the squats, save without applying.
  await page.goto(`/programs/${program.id}/cycles/9`);
  await page.getByRole("button", { name: /^Back Squat/ }).click();
  await page
    .getByRole("spinbutton", { name: "Every set: weight in lb" })
    .fill("100");
  await page.getByRole("button", { name: "Save cycle 9" }).click();
  await expect(sheet(page)).toContainText(
    "Cycle 12 is already logged and cannot be changed.",
  );
  await sheet(page)
    .getByRole("button", { name: "Save to cycle 9 only" })
    .click();
  await expect(page.getByText("Cycle 9 saved")).toBeVisible();
  const original = api.fingerprint(program.id, 1);
  expect(api.fingerprint(program.id, 8)).toBe(original);
  expect(api.fingerprint(program.id, 10)).toBe(original);
  expect(api.fingerprint(program.id, 9)).not.toBe(original);
  // The program page marks it.
  await expect(
    page.getByRole("list", { name: "Cycles" }).getByRole("listitem").nth(8),
  ).toContainText("Different from cycle 1");

  // "User overrides the guard": cycle 9 checked anyway is replaced.
  await addFacePullAndSave(page, program.id, 5);
  await expect(box(page, 9)).not.toBeChecked();
  await expect(sheet(page).getByRole("checkbox")).toHaveCount(6);
  await box(page, 9).check();
  await sheet(page)
    .getByRole("button", { name: "Save and apply to cycles 6–11" })
    .click();
  await expect(page.getByText("Applied to cycles 6–11 too.")).toBeVisible();
  expect(api.fingerprint(program.id, 9)).toBe(api.fingerprint(program.id, 5));
  expect(hasFacePull(api, program.id, 12)).toBe(false);
});

test("a cycle trained since the preview is refused with nothing written, the draft kept; a retried save writes once", async ({
  page,
}) => {
  const api = new FakeApi();
  const program = api.addProgram({ name: "Summer Strength", targetCycles: 12 });
  const original = api.fingerprint(program.id, 1);
  await api.install(page);
  await signIn(page);

  await addFacePullAndSave(page, program.id, 5);
  await expect(box(page, 6)).toBeChecked();
  // "Trained since preview": a session is logged against cycle 6 now.
  const s = newId();
  api.sessions.set(s, {
    id: s,
    workoutId: api.workout("Lower", 6, program.id).id,
    performedAt: "2026-10-28T13:00:00.000Z",
    status: "IN_PROGRESS",
  });
  await sheet(page)
    .getByRole("button", { name: "Save and apply to cycles 6–12" })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Not saved. This program changed after you opened it. Reload and try again. Your changes are kept on this device.",
  );
  for (let n = 1; n <= 12; n++) {
    expect(api.fingerprint(program.id, n)).toBe(original);
  }

  // The draft survives a reload, and saving again sees cycle 6 locked.
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.getByText("Unsaved changes restored")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Face Pull/ })).toBeVisible();
  await page.getByRole("button", { name: "Save cycle 5" }).click();
  await expect(sheet(page)).toContainText(
    "Cycle 6 is already logged and cannot be changed.",
  );

  // "Retried save": the answer is lost; saving again resends the same
  // request, which finds its effect in place.
  api.loseResponses = 1;
  await sheet(page)
    .getByRole("button", { name: "Save and apply to cycles 7–12" })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Couldn't reach Tanren's server",
  );
  const applied = api.fingerprint(program.id, 5);
  await page.getByRole("button", { name: "Save cycle 5" }).click();
  await expect(page.getByText("Cycle 5 saved")).toBeVisible();
  const [refused, lost, retried] = saves(api);
  expect(refused!.applyTo.map((t) => t.cycleNumber)).toEqual([
    6, 7, 8, 9, 10, 11, 12,
  ]);
  expect(retried).toEqual(lost);
  for (const n of [5, 7, 8, 9, 10, 11, 12]) {
    expect(api.fingerprint(program.id, n)).toBe(applied);
  }
  expect(api.fingerprint(program.id, 6)).toBe(original);
});

test("another device saves between opening a cycle and saving it: refused as stale, then saved against the reloaded fingerprint", async ({
  page,
}) => {
  const api = new FakeApi();
  const program = api.addProgram({ name: "Summer Strength", targetCycles: 4 });
  await api.install(page);
  await signIn(page);

  await page.goto(`/programs/${program.id}/cycles/2`);
  await expect(page.getByRole("region", { name: /^Workout 1:/ })).toBeVisible();
  // The other device: cycle 2 becomes a deload, after this editor loaded.
  deload(api, program.id, 2);
  const theirs = api.fingerprint(program.id, 2);

  await page
    .getByRole("region", { name: /^Workout 1:/ })
    .getByRole("button", { name: "Add exercise" })
    .click();
  const picker = page.getByRole("dialog", { name: /^Add to/ });
  await picker
    .getByRole("searchbox", { name: "Search exercises" })
    .fill("face");
  await picker.getByRole("button", { name: "Add Face Pull" }).click();
  await expect(picker).toBeHidden();
  await page.getByRole("button", { name: "Save cycle 2" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Not saved. Cycle 2 changed since you opened it.",
  );
  expect(saves(api)).toEqual([]);
  expect(api.fingerprint(program.id, 2)).toBe(theirs);

  // Reloading rebases the draft on the cycle as it now stands (the lifter's
  // draft is kept as written); the save then carries that read's
  // fingerprint.
  await page.getByRole("button", { name: "Reload cycle 2" }).click();
  await expect(page.getByText("Cycle 2 reloaded")).toBeVisible();
  await page.getByRole("button", { name: "Save cycle 2" }).click();
  await sheet(page)
    .getByRole("button", { name: "Save to cycle 2 only" })
    .click();
  await expect(page.getByText("Cycle 2 saved")).toBeVisible();
  const [saved] = saves(api);
  expect(saved!.expected.source).toBe(theirs);
  expect(hasFacePull(api, program.id, 2)).toBe(true);
});

test("an edit starts from a fresh read, never from a tree the program page cached", async ({
  page,
}) => {
  const api = new FakeApi();
  const program = api.addProgram({ name: "Summer Strength", targetCycles: 3 });
  await api.install(page);
  await signIn(page);

  // The program page reads cycle 1's tree (its workout count) and caches it.
  const cached = page.waitForResponse((r) =>
    r.url().endsWith(`/api/programs/${program.id}/cycles/1`),
  );
  await page.goto(`/programs/${program.id}`);
  await cached;
  await expect(page.getByRole("link", { name: "Edit cycle 1" })).toBeVisible();
  // Another device makes cycle 1 a deload while that tree sits in the cache.
  deload(api, program.id, 1);
  const theirs = api.fingerprint(program.id, 1);

  await page.getByRole("link", { name: "Edit cycle 1" }).click();
  await expect(page.getByRole("region", { name: /^Workout 1:/ })).toBeVisible();
  await page
    .getByRole("region", { name: /^Workout 1:/ })
    .getByRole("button", { name: "Add exercise" })
    .click();
  const picker = page.getByRole("dialog", { name: /^Add to/ });
  await picker
    .getByRole("searchbox", { name: "Search exercises" })
    .fill("face");
  await picker.getByRole("button", { name: "Add Face Pull" }).click();
  await expect(picker).toBeHidden();
  await page.getByRole("button", { name: "Save cycle 1" }).click();
  await sheet(page)
    .getByRole("button", { name: "Save to cycle 1 only" })
    .click();
  await expect(page.getByText("Cycle 1 saved")).toBeVisible();

  // The save was made against the tree it edited: the deload survives.
  const [saved] = saves(api);
  expect(saved!.expected.source).toBe(theirs);
  expect(hasFacePull(api, program.id, 1)).toBe(true);
  const squat = api.cycleOf(program.id, 1)[1]!.exercises[0]!;
  expect(squat.plannedSets.every((s) => s.targetWeight === 100)).toBe(true);
});
