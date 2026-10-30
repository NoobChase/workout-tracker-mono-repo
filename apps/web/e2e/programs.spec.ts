import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./support/fake-api/router.js";
import { signIn } from "./support/session.js";

/*
 * Task 8.1: the Programs screen against each `program-lifecycle` scenario.
 * Plan-side writes are plain online requests with client-minted ids, so a
 * retry after a lost response writes once.
 */

function group(page: Page, heading: string) {
  return page.getByRole("region", { name: new RegExp(`^${heading}`) });
}

function row(page: Page, name: string) {
  return page
    .getByRole("listitem")
    .filter({ has: page.getByRole("link", { name, exact: true }) });
}

async function menu(page: Page, program: string, item: string) {
  await page
    .getByRole("button", { name: `More for ${program}`, exact: true })
    .click();
  await page.getByRole("menuitem", { name: item }).click();
}

/** Home's what's next: continue and next cards. */
function today(page: Page) {
  return page.getByRole("region", { name: "What’s next" });
}

async function openPrograms(page: Page) {
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Programs" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Programs", level: 1 }),
  ).toBeVisible();
}

test("statuses and progress; activating a second program; archiving one early keeps its history", async ({
  page,
}) => {
  const api = new FakeApi();
  // Open-ended, in its fourth cycle.
  api.addProgram({ name: "Base Building", cycles: 4, resolvedThrough: 3 });
  const summer = api.addProgram({ name: "Summer Strength", targetCycles: 12 });
  api.addProgram({ name: "Couch to 5K", status: "DRAFT", targetCycles: 8 });
  api.addProgram({ name: "Old Block", status: "ARCHIVED", targetCycles: 6 });
  api.seedFinished(
    api.workout("Upper", 1, summer.id).id,
    "2026-10-20T13:00:00.000Z",
    { "Barbell Bench Press": [[185, 5]] },
  );
  await api.install(page);
  await signIn(page);
  await openPrograms(page);

  // "Mixed statuses": all four appear, each under its status.
  await expect(group(page, "Active").getByRole("link")).toHaveText([
    "Base Building",
    "Summer Strength",
  ]);
  await expect(group(page, "Drafts").getByRole("link")).toHaveText([
    "Couch to 5K",
  ]);
  const archived = page.getByRole("button", { name: /^Archived\s*1/ });
  await expect(archived).toHaveAttribute("aria-expanded", "false");
  await archived.click();
  await expect(group(page, "Archived").getByRole("link")).toHaveText([
    "Old Block",
  ]);

  // "Open-ended progress": Cycle 4, no total; a fixed one has its total.
  await expect(row(page, "Base Building")).toContainText(
    "Open-ended · Cycle 4",
  );
  await expect(row(page, "Base Building")).not.toContainText(" of ");
  await expect(row(page, "Summer Strength")).toContainText(
    "12 cycles · Cycle 1 of 12",
  );
  await expect(row(page, "Couch to 5K")).toContainText(
    "8 cycles · Not started",
  );

  // "Second active program": activating never touches another, and what's
  // next offers a workout from each.
  await row(page, "Couch to 5K")
    .getByRole("button", { name: "Activate Couch to 5K" })
    .click();
  await expect(group(page, "Active").getByRole("link")).toHaveText([
    "Base Building",
    "Summer Strength",
    "Couch to 5K",
  ]);
  expect(api.programs.map((p) => p.status)).toEqual([
    "ACTIVE",
    "ACTIVE",
    "ACTIVE",
    "ARCHIVED",
  ]);
  await page.getByRole("link", { name: "Tanren, home" }).click();
  for (const name of ["Base Building", "Summer Strength", "Couch to 5K"]) {
    await expect(today(page).getByText(`${name} · Cycle`)).toBeVisible();
  }

  // "Stopping a program early": archived, not completed; history stays.
  await openPrograms(page);
  await menu(page, "Summer Strength", "Archive");
  await expect(
    page.getByRole("button", { name: /^Archived\s*2/ }),
  ).toBeVisible();
  expect(api.program("Summer Strength").status).toBe("ARCHIVED");
  await page.getByRole("link", { name: "Tanren, home" }).click();
  await expect(today(page).getByText("Base Building · Cycle 4")).toBeVisible();
  await expect(today(page).getByText("Summer Strength · Cycle")).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "History" })
    .click();
  await expect(
    page
      .getByRole("list", { name: "Finished workouts" })
      .getByRole("link", { name: /Summer Strength/ }),
  ).toHaveCount(1);
});

test("copy: a free name suggested and editable, an independent draft, a retried copy written once", async ({
  page,
}) => {
  const api = new FakeApi();
  const source = api.addProgram({ name: "Summer Strength", targetCycles: 12 });
  api.addProgram({
    name: "Summer Strength (2)",
    status: "ARCHIVED",
    targetCycles: 12,
  });
  await api.install(page);
  await signIn(page);
  await openPrograms(page);

  // "Name collision": with (2) taken, the copy is (3).
  await menu(page, "Summer Strength", "Copy…");
  const dialog = page.getByRole("dialog", { name: "Copy Summer Strength" });
  await expect(dialog.getByRole("textbox", { name: "Name" })).toHaveValue(
    "Summer Strength (3)",
  );
  await dialog.getByRole("button", { name: "Make the copy" }).click();
  await expect(dialog).toBeHidden();
  await expect(group(page, "Drafts").getByRole("link")).toHaveText([
    "Summer Strength (3)",
  ]);
  const copy = api.program("Summer Strength (3)");
  expect(copy).toMatchObject({ status: "DRAFT", targetCycles: 12 });

  // "Copy keeps the source intact": no row shared, the source unchanged.
  const sourceIds = new Set(
    api.workouts.filter((w) => w.programId === source.id).map((w) => w.id),
  );
  const copied = api.workouts.filter((w) => w.programId === copy.id);
  expect(copied).toHaveLength(24);
  expect(copied.some((w) => sourceIds.has(w.id))).toBe(false);
  expect(api.program("Summer Strength").status).toBe("ACTIVE");

  // Renamed in the flow, and "Retried copy": the answer is lost, the
  // lifter taps again, the same id is sent and one copy exists.
  api.loseResponses = 1;
  await menu(page, "Summer Strength", "Copy…");
  await dialog.getByRole("textbox", { name: "Name" }).fill("Winter Strength");
  await dialog.getByRole("button", { name: "Make the copy" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Couldn't reach Tanren's server",
  );
  await dialog.getByRole("button", { name: "Make the copy" }).click();
  await expect(dialog).toBeHidden();
  const copies = api.bodies.filter(
    (b): b is { newProgramId: string } =>
      typeof b === "object" && b !== null && "newProgramId" in b,
  );
  expect(copies).toHaveLength(3);
  expect(copies[1]!.newProgramId).toBe(copies[2]!.newProgramId);
  expect(api.programs.filter((p) => p.name === "Winter Strength")).toHaveLength(
    1,
  );
  await expect(group(page, "Drafts").getByRole("link")).toHaveText([
    "Summer Strength (3)",
    "Winter Strength",
  ]);
});

test("rename everywhere, a clash refused by name, and one more cycle of a finished program (retried once)", async ({
  page,
}) => {
  const api = new FakeApi();
  const base = api.addProgram({ name: "Base Building" });
  api.seedFinished(
    api.workout("Upper", 1, base.id).id,
    "2026-10-20T13:00:00.000Z",
    {
      "Barbell Bench Press": [[185, 5]],
    },
  );
  const done = api.addProgram({
    name: "Summer Strength",
    targetCycles: 12,
    resolvedThrough: 12,
    status: "COMPLETED",
  });
  await api.install(page);
  await signIn(page);
  await openPrograms(page);

  // "Rename": the program, history and what's next show the new name.
  await menu(page, "Base Building", "Rename…");
  const rename = page.getByRole("dialog", { name: "Rename Base Building" });
  await rename.getByRole("textbox", { name: "Name" }).fill("Summer Strength");
  await rename.getByRole("button", { name: "Rename" }).click();
  await expect(rename.getByRole("alert")).toHaveText(
    'You already have a program named "Summer Strength".',
  );
  await rename.getByRole("textbox", { name: "Name" }).fill("Winter Base");
  await rename.getByRole("button", { name: "Rename" }).click();
  await expect(rename).toBeHidden();
  await expect(group(page, "Active").getByRole("link")).toHaveText([
    "Winter Base",
  ]);
  await page.getByRole("link", { name: "Tanren, home" }).click();
  await expect(today(page).getByText("Winter Base · Cycle 1")).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Recent workouts" }),
  ).toContainText("Winter Base");

  // "Extending a completed program", with "Retried extend".
  await openPrograms(page);
  await expect(row(page, "Summer Strength")).toContainText(
    "All 12 cycles done",
  );
  api.loseResponses = 1;
  const extend = page.getByRole("button", {
    name: "Run another cycle of Summer Strength",
  });
  await extend.click();
  await expect(page.getByRole("alert")).toContainText(
    "Couldn’t change Summer Strength.",
  );
  await extend.click();
  await expect(group(page, "Active").getByRole("link")).toHaveText([
    "Winter Base",
    "Summer Strength",
  ]);
  await expect(row(page, "Summer Strength")).toContainText(
    "13 cycles · Cycle 13 of 13",
  );
  expect(api.program("Summer Strength")).toMatchObject({
    status: "ACTIVE",
    targetCycles: 13,
  });
  expect(api.cycleOf(done.id, 13).map((w) => w.name)).toEqual(
    api.cycleOf(done.id, 12).map((w) => w.name),
  );
  expect(api.plans.filter((p) => p.programId === done.id)).toHaveLength(13);
});

test("a lapsed account can read its programs but a copy is refused and nothing is written", async ({
  page,
}) => {
  const api = new FakeApi();
  api.addProgram({ name: "Summer Strength", targetCycles: 12 });
  api.lapsed = true;
  await api.install(page);
  await signIn(page);
  await openPrograms(page);

  await expect(group(page, "Active").getByRole("link")).toHaveText([
    "Summer Strength",
  ]);
  await menu(page, "Summer Strength", "Copy…");
  const dialog = page.getByRole("dialog", { name: "Copy Summer Strength" });
  await dialog.getByRole("button", { name: "Make the copy" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Changing programs needs an active subscription.",
  );
  expect(api.programs).toHaveLength(1);
});

test("offline, the list stays readable and every change says it needs a connection", async ({
  page,
  context,
}) => {
  const api = new FakeApi();
  api.addProgram({ name: "Couch to 5K", status: "DRAFT", targetCycles: 8 });
  await api.install(page);
  await signIn(page);
  await openPrograms(page);
  await expect(group(page, "Drafts").getByRole("link")).toHaveText([
    "Couch to 5K",
  ]);

  await context.setOffline(true);
  await expect(
    page.getByText(/changing a program needs a connection/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Activate Couch to 5K" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "More for Couch to 5K" }).click();
  await expect(page.getByRole("menuitem", { name: "Copy…" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.keyboard.press("Escape");
  expect(api.writes).toEqual([]);
});

test("the program page offers View for a cycle with every workout logged, Edit otherwise", async ({
  page,
}) => {
  const api = new FakeApi();
  // Upper/Lower: cycle 1 fully logged, cycle 2 part-way, cycle 3 untouched.
  const program = api.addProgram({
    name: "Base",
    targetCycles: 3,
    resolvedThrough: 1,
  });
  api.seedFinished(
    api.workout("Upper", 2, program.id).id,
    "2026-10-27T13:00:00.000Z",
    {},
  );
  await api.install(page);
  await signIn(page);

  await page.goto(`/programs/${program.id}`);
  await expect(page.getByRole("link", { name: "View cycle 1" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit cycle 2" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit cycle 3" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit cycle 1" })).toHaveCount(0);
});
