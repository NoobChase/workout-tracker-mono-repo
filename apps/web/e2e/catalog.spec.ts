import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./support/fake-api/router.js";
import { signIn } from "./support/session.js";

/*
 * Task 8.2: the exercise catalog screen and the picker against each
 * `exercise-catalog` scenario. The catalog is fetched whole and filtered on
 * the device (design D11); its writes are online requests with
 * client-minted ids.
 */

async function openCatalog(page: Page) {
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Programs" })
    .click();
  await page.getByRole("link", { name: "Exercises" }).click();
  await expect(
    page.getByRole("heading", { name: "Exercises", level: 1 }),
  ).toBeVisible();
}

function list(page: Page) {
  return page.getByRole("list", { name: "Exercises" });
}

/** The names in the list, in order. */
async function names(page: Page) {
  return list(page)
    .getByRole("button")
    .evaluateAll((buttons) =>
      buttons.map((b) => b.querySelector("span span")?.textContent ?? ""),
    );
}

function sheet(page: Page) {
  return page.getByRole("dialog");
}

test("browsing, filtering by muscle, equipment and name, in any combination", async ({
  page,
}) => {
  const api = new FakeApi();
  api.addExercise("Reverse Hyper", {
    primaryMuscles: ["GLUTES"],
    equipment: "MACHINE",
  });
  await api.install(page);
  await signIn(page);
  await openCatalog(page);

  // "Browsing": standard and the lifter's own, by name.
  const all = await names(page);
  expect(all).toEqual([...all].sort((a, b) => a.localeCompare(b)));
  expect(all).toContain("Back Squat");
  expect(all).toContain("Reverse Hyper");
  await expect(
    list(page).getByRole("button", { name: "Reverse Hyper" }),
  ).toContainText("Yours");

  // "Muscle filter": QUADS as a primary or a secondary muscle.
  await page.getByRole("combobox", { name: "Muscle" }).selectOption("QUADS");
  expect(await names(page)).toEqual([
    "Back Squat",
    "Bulgarian Split Squat",
    "Front Squat",
    "Leg Press",
  ]);
  // With equipment too.
  await page
    .getByRole("combobox", { name: "Equipment" })
    .selectOption("BARBELL");
  expect(await names(page)).toEqual(["Back Squat", "Front Squat"]);

  // "Name search": any case, anywhere in the name.
  await page.getByRole("combobox", { name: "Muscle" }).selectOption("");
  await page.getByRole("combobox", { name: "Equipment" }).selectOption("");
  await page.getByRole("searchbox", { name: "Search exercises" }).fill("ROW");
  expect(await names(page)).toEqual(["Barbell Row", "Seated Cable Row"]);
  // Reads only: nothing was written.
  expect(api.writes).toEqual([]);
});

test("creating a custom exercise with its metrics; a retried create writes once; a name clash is named", async ({
  page,
}) => {
  const api = new FakeApi();
  await api.install(page);
  await signIn(page);
  await openCatalog(page);

  // "Clash with a standard exercise", ignoring case.
  await page.getByRole("button", { name: "Create custom exercise" }).click();
  await sheet(page).getByLabel("Name").fill("back squat");
  await sheet(page).getByRole("button", { name: "Create exercise" }).click();
  await expect(sheet(page).getByRole("alert")).toHaveText(
    '"Back Squat" already exists.',
  );

  // "Secondary without primary": the form asks for a primary first.
  await expect(
    sheet(page).getByText("Choose a primary muscle first."),
  ).toBeVisible();
  const secondary = sheet(page).getByRole("group", {
    name: /Secondary muscles/,
  });
  await expect(
    secondary.getByRole("button", { name: "Hamstrings" }),
  ).toBeDisabled();

  // "Usually bodyweight, sometimes loaded": reps required, weight optional.
  await sheet(page).getByLabel("Name").fill("Reverse Hyper");
  await sheet(page)
    .getByRole("radiogroup", { name: "Weight: required or optional" })
    .getByRole("radio", { name: "Optional" })
    .click();
  await sheet(page)
    .getByRole("group", { name: "Primary muscles" })
    .getByRole("button", { name: "Glutes" })
    .click();
  await secondary.getByRole("button", { name: "Hamstrings" }).click();
  // "Retrying a create": the first answer is lost; the retry has the same id.
  api.loseResponses = 1;
  await sheet(page).getByRole("button", { name: "Create exercise" }).click();
  await expect(sheet(page).getByRole("alert")).toContainText(
    "Couldn't reach Tanren's server",
  );
  await sheet(page).getByRole("button", { name: "Create exercise" }).click();
  await expect(sheet(page)).toBeHidden();

  const posts = api.bodies.filter(
    (_, i) => api.writes[i] === "POST /api/exercises",
  ) as { id: string; name: string; metrics: unknown }[];
  expect(posts.map((b) => b.name)).toEqual([
    "back squat",
    "Reverse Hyper",
    "Reverse Hyper",
  ]);
  expect(posts[1]!.id).toBe(posts[2]!.id);
  expect(
    [...api.exercises.values()].filter((e) => e.name === "Reverse Hyper"),
  ).toHaveLength(1);
  expect(api.exercise("Reverse Hyper").metrics).toEqual([
    { metric: "REPS", isRequired: true },
    { metric: "WEIGHT", isRequired: false },
  ]);
  await expect(
    list(page).getByRole("button", { name: "Reverse Hyper" }),
  ).toContainText("Glutes");

  // Its detail says what it records, metrics fixed.
  await list(page).getByRole("button", { name: "Reverse Hyper" }).click();
  await expect(sheet(page)).toContainText("Reps, weight (optional)");
});

test("editing: their own (never metrics), not a standard one; setup and cues on any", async ({
  page,
}) => {
  const api = new FakeApi();
  api.addExercise("Reverse Hyper", { primaryMuscles: ["GLUTES"] });
  await api.install(page);
  await signIn(page);
  await openCatalog(page);

  // "Editing a standard exercise": no edit, no retire; notes only.
  await list(page).getByRole("button", { name: "Back Squat" }).click();
  await expect(sheet(page).getByRole("heading")).toContainText("Back Squat");
  await expect(
    sheet(page).getByRole("button", { name: /Edit name/ }),
  ).toHaveCount(0);
  await expect(sheet(page).getByRole("button", { name: "Retire" })).toHaveCount(
    0,
  );

  // "Annotating a standard exercise".
  await sheet(page).getByLabel("Your setup").fill("pins at 4");
  await sheet(page).getByLabel("Your cues").fill("Brace first");
  await sheet(page).getByRole("button", { name: "Save notes" }).click();
  await expect(page.getByText("Notes saved on Back Squat")).toBeVisible();
  expect(api.exercise("Back Squat")).toMatchObject({
    setup: "pins at 4",
    cues: "Brace first",
  });
  await page.keyboard.press("Escape");
  await list(page).getByRole("button", { name: "Back Squat" }).click();
  await expect(sheet(page).getByLabel("Your setup")).toHaveValue("pins at 4");
  await page.keyboard.press("Escape");

  // "Renaming their own": the form shows metrics as fixed, not editable.
  await list(page).getByRole("button", { name: "Reverse Hyper" }).click();
  await sheet(page)
    .getByRole("button", { name: "Edit name, muscles or equipment" })
    .click();
  await expect(sheet(page).getByText("Fixed once created")).toBeVisible();
  await expect(sheet(page).getByRole("checkbox")).toHaveCount(0);
  await sheet(page).getByLabel("Name").fill("Reverse Hyperextension");
  await sheet(page).getByRole("button", { name: "Save changes" }).click();
  await expect(sheet(page).getByRole("heading")).toContainText(
    "Reverse Hyperextension",
  );
  await page.keyboard.press("Escape");
  await expect(
    list(page).getByRole("button", { name: "Reverse Hyperextension" }),
  ).toBeVisible();
  const patch = api.bodies[api.writes.findIndex((w) => w.startsWith("PATCH"))];
  expect(patch).not.toHaveProperty("metrics");
  expect(api.exercise("Reverse Hyperextension").isCustom).toBe(true);
});

test("retiring hides it from pickers and keeps history; reactivating brings it back", async ({
  page,
}) => {
  const api = new FakeApi();
  const hyper = api.addExercise("Reverse Hyper");
  const program = api.addProgram({
    name: "Posterior",
    workouts: [["Hinge", [["Reverse Hyper", 3, 10, 15]]]],
    cycles: 2,
  });
  api.seedFinished(
    api.workout("Hinge", 1, program.id).id,
    "2026-10-20T13:00:00.000Z",
    { "Reverse Hyper": [[45, 12]] },
  );
  await api.install(page);
  await signIn(page);
  await openCatalog(page);

  // "Retiring a used exercise".
  await list(page).getByRole("button", { name: "Reverse Hyper" }).click();
  await sheet(page).getByRole("button", { name: "Retire" }).click();
  await expect(page.getByText("Reverse Hyper retired")).toBeVisible();
  expect(api.exercises.get(hyper.id)!.isActive).toBe(false);
  await expect(
    list(page).getByRole("button", { name: "Reverse Hyper" }),
  ).toHaveCount(0);

  // Not in the picker.
  await page.goto("/programs/new");
  await page.getByRole("button", { name: "Add exercise" }).click();
  const picker = page.getByRole("dialog", { name: /^Add to/ });
  await picker
    .getByRole("searchbox", { name: "Search exercises" })
    .fill("hyper");
  await expect(picker.getByText("Nothing matches.")).toBeVisible();
  await page.keyboard.press("Escape");

  // History still shows it by name.
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "History" })
    .click();
  await page.getByRole("link", { name: /Hinge/ }).first().click();
  await expect(page.getByText("Reverse Hyper")).toBeVisible();

  // "Reactivating": Show retired, then Reactivate.
  await openCatalog(page);
  await page.getByRole("switch", { name: "Show retired" }).click();
  await list(page).getByRole("button", { name: "Reverse Hyper" }).click();
  await sheet(page).getByRole("button", { name: "Reactivate" }).click();
  await expect(
    page.getByText("Reverse Hyper is back in your pickers"),
  ).toBeVisible();
  expect(api.exercises.get(hyper.id)!.isActive).toBe(true);

  await page.goto("/programs/new");
  await page.getByRole("button", { name: "Add exercise" }).click();
  await page
    .getByRole("dialog", { name: /^Add to/ })
    .getByRole("searchbox", { name: "Search exercises" })
    .fill("hyper");
  await expect(
    page.getByRole("button", { name: "Add Reverse Hyper" }),
  ).toBeVisible();
});

test("a lapsed account can browse but not create", async ({ page }) => {
  const api = new FakeApi();
  api.lapsed = true;
  await api.install(page);
  await signIn(page);
  await openCatalog(page);
  await expect(list(page).getByRole("button").first()).toBeVisible();
  const before = api.exercises.size;

  await page.getByRole("button", { name: "Create custom exercise" }).click();
  await sheet(page).getByLabel("Name").fill("Reverse Hyper");
  await sheet(page).getByRole("button", { name: "Create exercise" }).click();
  await expect(sheet(page).getByRole("alert")).toContainText(
    "Changing exercises needs an active subscription",
  );
  expect(api.exercises.size).toBe(before);
});
