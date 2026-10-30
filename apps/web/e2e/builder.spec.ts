import { expect, test, type Page } from "@playwright/test";
import type { CreateProgramRequest } from "@workout-tracker/shared";
import { FakeApi } from "./support/fake-api/router.js";
import { signIn } from "./support/session.js";

/*
 * Task 9.1: the builder (brief `apps-web-src-builder`; operations.md 3.1-3.7;
 * design D3-D5, D14). Create a 12-cycle program from scratch with a reload
 * mid-build, reorder by keyboard and by drag, and edit a cycle whose
 * trained workout stays frozen.
 */

function workout(page: Page, n: number) {
  return page.getByRole("region", { name: new RegExp(`^Workout ${n}:`) });
}

/** A slot's row button (its accessible name is the name, then the summary). */
function slot(page: Page, name: string) {
  return page.getByRole("button", {
    name: new RegExp(`^(Superset [A-Z]\\d: )?(Placeholder: )?“?${name}`),
  });
}

async function addExercise(page: Page, n: number, name: string) {
  await workout(page, n).getByRole("button", { name: "Add exercise" }).click();
  const picker = page.getByRole("dialog", { name: /^Add to/ });
  await picker.getByRole("searchbox", { name: "Search exercises" }).fill(name);
  await picker
    .getByRole("button", { name: `Add ${name}`, exact: true })
    .click();
  await expect(picker).toBeHidden();
}

async function menu(page: Page, of: string, item: string) {
  await page
    .getByRole("button", { name: `More for ${of}`, exact: true })
    .click();
  await page.getByRole("menuitem", { name: item }).click();
}

test("create a 12-cycle program from scratch; a reload mid-build restores the draft", async ({
  page,
}) => {
  const api = new FakeApi();
  api.addProgram({ name: "Summer Strength", status: "ARCHIVED" });
  await api.install(page);
  await signIn(page);

  await page.getByRole("link", { name: "Programs" }).first().click();
  await page.getByRole("button", { name: "New program" }).click();
  await page.getByRole("button", { name: /^Create from scratch/ }).click();
  await expect(page).toHaveURL(/\/programs\/new$/);
  await expect(
    page.getByRole("heading", { name: "New program" }),
  ).toBeVisible();
  // Cycle 1 alone in the strip, and nothing written by opening the builder.
  await expect(
    page.getByRole("navigation", { name: "Cycles" }).getByText(/\d/),
  ).toHaveText(["1"]);

  await page.getByLabel("Name", { exact: true }).fill("Summer Strength");
  await expect(
    page.getByRole("spinbutton", { name: "Number of cycles" }),
  ).toHaveValue("12");

  // Push: bench 5 × 5 @ 225 lb, RIR 2, supersetted with rows; a placeholder.
  await page.getByRole("textbox", { name: "Name of workout 1" }).fill("Push");
  await page
    .getByRole("textbox", { name: "Notes for Push" })
    .fill("Rest 3 min on bench");
  await addExercise(page, 1, "Barbell Bench Press");
  // A new slot opens in place.
  await page.getByRole("button", { name: "One set more" }).click();
  await page.getByRole("button", { name: "One set more" }).click();
  await page.getByRole("spinbutton", { name: "Every set: reps" }).fill("5");
  await page
    .getByRole("spinbutton", { name: "Every set: weight in lb" })
    .fill("225");
  await page.getByRole("spinbutton", { name: /Every set: RIR/ }).fill("2");
  await expect(slot(page, "Barbell Bench Press")).toContainText(
    "5 × 5 @ 225 lb · RIR 2",
  );
  await slot(page, "Barbell Bench Press").click();
  await addExercise(page, 1, "Barbell Row");
  await slot(page, "Barbell Row").click();
  await menu(page, "Barbell Bench Press", "Superset with next");
  await expect(slot(page, "Barbell Bench Press")).toHaveAccessibleName(
    /^Superset A1: Barbell Bench Press/,
  );
  await expect(slot(page, "Barbell Row")).toHaveAccessibleName(
    /^Superset A2: Barbell Row/,
  );
  await workout(page, 1).getByRole("button", { name: "Add exercise" }).click();
  await page.getByRole("button", { name: "Add a placeholder instead" }).click();
  await page.getByLabel("Label").fill("conditioning finisher");
  await page.getByRole("button", { name: "Add placeholder" }).click();
  await expect(slot(page, "conditioning finisher")).toContainText("3 sets");

  // Reload mid-build: the draft is restored from the device.
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.getByText("Unsaved changes restored")).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Summer Strength",
  );
  await expect(slot(page, "Barbell Bench Press")).toContainText(
    "5 × 5 @ 225 lb · RIR 2",
  );
  await expect(slot(page, "conditioning finisher")).toBeVisible();

  // Pull: face pulls prescribed set by set, the last by RPE.
  await page.getByRole("button", { name: "Add workout" }).click();
  await page.getByRole("textbox", { name: "Name of workout 2" }).fill("Pull");
  await addExercise(page, 2, "Face Pull");
  await page.getByRole("switch", { name: "Prescribe each set" }).click();
  await page.getByRole("spinbutton", { name: "Set 1: reps" }).fill("15");
  await page.getByRole("spinbutton", { name: "Set 2: reps" }).fill("12");
  await page
    .getByRole("group", { name: "Set 3" })
    .getByRole("radio", { name: /RPE/ })
    .click();
  await page.getByRole("spinbutton", { name: /Set 3: RPE/ }).fill("8");
  await expect(slot(page, "Face Pull")).toContainText(
    "3 sets · each set prescribed",
  );
  await page.getByRole("button", { name: "Add workout" }).click();
  await page.getByRole("textbox", { name: "Name of workout 3" }).fill("Legs");
  await addExercise(page, 3, "Back Squat");

  // A clashing name is refused by name; the draft stays.
  await page.getByRole("button", { name: "Create program" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    'You already have a program named "Summer Strength".',
  );
  await page.getByLabel("Name", { exact: true }).fill("Summer Strength II");
  await page.getByRole("button", { name: "Create program" }).click();

  // A DRAFT with 12 identical cycles of three workouts.
  await expect(page).toHaveURL(/\/programs\/[0-9a-f-]+$/);
  await expect(
    page.getByRole("heading", { name: "Summer Strength II", level: 1 }),
  ).toBeVisible();
  const cycles = page
    .getByRole("list", { name: "Cycles" })
    .getByRole("listitem");
  await expect(cycles).toHaveCount(12);
  await expect(cycles.first()).toContainText("Cycle 1 · 3 workouts");
  await expect(cycles.nth(11)).toContainText("Same as cycle 1");
  const program = api.program("Summer Strength II");
  expect(program).toMatchObject({ status: "DRAFT", targetCycles: 12 });
  for (let n = 1; n <= 12; n++) {
    expect(api.cycleOf(program.id, n).map((w) => w.name)).toEqual([
      "Push",
      "Pull",
      "Legs",
    ]);
  }
  expect(api.fingerprint(program.id, 12)).toBe(api.fingerprint(program.id, 1));

  // The request: ids minted on the device, the same on both tries.
  const creates = api.bodies.filter(
    (_, i) => api.writes[i] === "POST /api/programs",
  ) as CreateProgramRequest[];
  expect(creates).toHaveLength(2);
  expect(creates[0]!.programId).toBe(creates[1]!.programId);
  const [push, pull] = creates[1]!.cycle.workouts;
  expect(push!.notes).toBe("Rest 3 min on bench");
  const [bench, row, finisher] = push!.plannedExercises;
  expect(bench!.targetSets).toBe(5);
  expect(
    bench!.plannedSets.map((s) => [
      s.targetRepsMin,
      s.targetWeight,
      s.weightUnit,
      s.targetRir,
      s.targetRpe,
    ]),
  ).toEqual(Array(5).fill([5, 225, "LB", 2, null]));
  expect(bench!.groupKey).not.toBeNull();
  expect(row!.groupKey).toBe(bench!.groupKey);
  expect(finisher).toMatchObject({
    exerciseId: null,
    placeholderLabel: "conditioning finisher",
    targetSets: 3,
  });
  expect(
    pull!.plannedExercises[0]!.plannedSets.map((s) => [
      s.setNumber,
      s.targetRepsMin,
      s.targetRpe,
    ]),
  ).toEqual([
    [1, 15, null],
    [2, 12, null],
    [3, null, 8],
  ]);

  // Saved, so the draft is gone.
  await page.goto("/programs/new");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("");
  await expect(page.getByText("Unsaved changes restored")).toHaveCount(0);
});

test("reordering slots by keyboard and by drag", async ({ page }) => {
  const api = new FakeApi();
  await api.install(page);
  await signIn(page);
  await page.goto("/programs/new");
  for (const name of ["Back Squat", "Leg Press", "Lying Leg Curl"]) {
    await addExercise(page, 1, name);
    await slot(page, name).click();
  }
  const order = () =>
    workout(page, 1)
      .getByRole("button", { name: /^Reorder / })
      .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));

  // Keyboard: the handle moves its slot with the arrow keys and says so.
  await page.getByRole("button", { name: /^Reorder Back Squat/ }).focus();
  await page.keyboard.press("ArrowDown");
  expect(await order()).toEqual([
    "Reorder Leg Press: arrow keys move it",
    "Reorder Back Squat: arrow keys move it",
    "Reorder Lying Leg Curl: arrow keys move it",
  ]);
  await expect(page.getByText("Back Squat moved to 2 of 3.")).toBeAttached();
  await expect(
    page.getByRole("button", { name: /^Reorder Back Squat/ }),
  ).toBeFocused();

  // Drag (laptop): Lying Leg Curl to the top.
  const handle = page.getByRole("button", { name: /^Reorder Lying Leg Curl/ });
  const target = await slot(page, "Leg Press").boundingBox();
  const from = await handle.boundingBox();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(from!.x + 10, target!.y + 4, { steps: 8 });
  await page.mouse.up();
  expect(await order()).toEqual([
    "Reorder Lying Leg Curl: arrow keys move it",
    "Reorder Leg Press: arrow keys move it",
    "Reorder Back Squat: arrow keys move it",
  ]);
  expect(api.writes).toEqual([]);
});

test("editing a cycle: trained workouts are frozen; the rest saves; offline keeps the draft", async ({
  page,
}) => {
  const api = new FakeApi();
  const program = api.addProgram({ name: "Base", targetCycles: 4 });
  const upper = api.workout("Upper", 1, program.id);
  api.seedFinished(upper.id, "2026-10-20T13:00:00.000Z", {
    "Barbell Bench Press": [[185, 5]],
  });
  const before = structuredClone(api.cycleOf(program.id, 1));
  await api.install(page);
  await signIn(page);

  await page.goto(`/programs/${program.id}`);
  await page.getByRole("link", { name: "Edit cycle 1" }).click();
  await expect(
    page.getByRole("heading", { name: "Base", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Cycle 1, logged" }),
  ).toHaveAttribute("aria-current", "page");

  // Upper is logged: greyed, "Logged <day> · locked", nothing to edit or move.
  const locked = page.locator("section[data-locked]");
  await expect(locked).toHaveCount(1);
  await expect(locked).toContainText("Upper");
  await expect(locked).toContainText(/Logged Tue, Oct 20(, 2026)? · locked/);
  await expect(locked.getByRole("button")).toHaveCount(0);
  await expect(locked.getByRole("textbox")).toHaveCount(0);
  await expect(locked.getByRole("spinbutton")).toHaveCount(0);
  // Lower can't move up across it.
  await page
    .getByRole("button", { name: "More for Lower", exact: true })
    .click();
  await expect(page.getByRole("menuitem", { name: "Move up" })).toBeDisabled();
  await page.keyboard.press("Escape");

  // Offline: saving needs a connection, and the edit stays on the device.
  await slot(page, "Back Squat").click();
  await page.getByRole("button", { name: "One set more" }).click();
  await expect(slot(page, "Back Squat")).toContainText("4 × 5–8");
  await page.context().setOffline(true);
  await expect(
    page.getByText(
      "Saving needs a connection. Your changes are kept on this device.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save cycle 1" }),
  ).toBeDisabled();
  await page.waitForTimeout(400);
  await page.context().setOffline(false);
  await page.reload();
  await expect(page.getByText("Unsaved changes restored")).toBeVisible();
  await expect(slot(page, "Back Squat")).toContainText("4 × 5–8");

  // Discarding is one tap, with an Undo that puts the draft back.
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(page.getByText("Changes discarded")).toBeVisible();
  await expect(slot(page, "Back Squat")).toContainText("3 × 5–8");
  await expect(page.getByText("No changes yet.")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(slot(page, "Back Squat")).toContainText("4 × 5–8");
  await expect(
    page.getByText("Unsaved changes, kept on this device."),
  ).toBeVisible();

  // Save to this cycle only: Upper unchanged, Lower's squat has 4 sets.
  await page.getByRole("button", { name: "Save cycle 1" }).click();
  const apply = page.getByRole("dialog", { name: "Apply to later cycles?" });
  await apply.getByRole("button", { name: "Save to cycle 1 only" }).click();
  await expect(page).toHaveURL(new RegExp(`/programs/${program.id}$`));
  await expect(page.getByText("Cycle 1 saved")).toBeVisible();
  const after = api.cycleOf(program.id, 1);
  expect(after[0]).toEqual(before[0]);
  expect(after[1]!.exercises[0]!.targetSets).toBe(4);
  expect(api.cycleOf(program.id, 2)[1]!.exercises[0]!.targetSets).toBe(3);
  // Cycle 1 changed alone, so cycles 2-4 now differ from it.
  await expect(
    page.getByRole("list", { name: "Cycles" }).getByRole("listitem").nth(1),
  ).toContainText("Different from cycle 1");
});

test("weights are prescribed in the lifter's units: the default, and an exercise's override", async ({
  page,
}) => {
  const bench = "01a170d4-dadd-708f-b947-8d2400bbbb5c";
  const api = new FakeApi({
    units: { default: "KG", overrides: { [bench]: "LB" } },
  });
  await api.install(page);
  await signIn(page);

  await page.goto("/programs/new");
  await page.getByLabel("Name", { exact: true }).fill("Metric Base");
  await addExercise(page, 1, "Back Squat");
  await page.getByRole("spinbutton", { name: "Every set: reps" }).fill("5");
  await page
    .getByRole("spinbutton", { name: "Every set: weight in kg" })
    .fill("100");
  await expect(slot(page, "Back Squat")).toContainText("3 × 5 @ 100 kg");
  await slot(page, "Back Squat").click();
  await addExercise(page, 1, "Barbell Bench Press");
  await page
    .getByRole("spinbutton", { name: "Every set: weight in lb" })
    .fill("225");
  await expect(slot(page, "Barbell Bench Press")).toContainText("@ 225 lb");

  await page.getByRole("button", { name: "Create program" }).click();
  await expect(page).toHaveURL(/\/programs\/[0-9a-f-]+$/);
  const create = api.bodies.at(-1) as CreateProgramRequest;
  const [squat, press] = create.cycle.workouts[0]!.plannedExercises;
  expect(squat!.plannedSets.map((s) => s.weightUnit)).toEqual(
    Array(3).fill("KG"),
  );
  expect(press!.plannedSets.map((s) => s.weightUnit)).toEqual(
    Array(3).fill("LB"),
  );
});
