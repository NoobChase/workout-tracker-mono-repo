import { expect, type Page } from "@playwright/test";

/** The current exercise's block: its heading names the region. */
export function live(page: Page, exercise: string) {
  return page.getByRole("region", { name: exercise, exact: true });
}

/** One exercise's rows in today's log. */
export function rows(page: Page, exercise: string) {
  return page
    .getByRole("list", { name: `${exercise} sets`, exact: true })
    .getByRole("listitem");
}

/** A logged set's row, as the button that opens it for editing. */
export function setButton(page: Page, exercise: string, n: number) {
  return page
    .getByRole("list", { name: `${exercise} sets`, exact: true })
    .getByRole("button", { name: new RegExp(`^Set ${n},`) });
}

/** Types the numbers (when given) and logs the set. */
export async function logSet(
  page: Page,
  exercise: string,
  numbers: { weight?: number; reps?: number } = {},
) {
  const block = live(page, exercise);
  if (numbers.weight !== undefined) {
    await block
      .getByRole("spinbutton", { name: "Weight" })
      .fill(String(numbers.weight));
  }
  if (numbers.reps !== undefined) {
    await block
      .getByRole("spinbutton", { name: "Reps" })
      .fill(String(numbers.reps));
  }
  const before = await rows(page, exercise)
    .filter({ hasNotText: /now/i })
    .filter({ has: page.getByRole("button") })
    .count()
    .catch(() => 0);
  await block.getByRole("button", { name: "Log set" }).click();
  await expect(
    rows(page, exercise).filter({ has: page.getByRole("button") }),
  ).toHaveCount(before + 1);
}

/** The sync line's words, wherever the header puts it. */
export function syncLine(page: Page) {
  return page.locator('[data-slot="sync-status"]');
}

/**
 * A set's figures as the page's text has them ("225 lb× for 5 reps": the ×
 * is hidden from assistive tech, which hears "for … reps" instead).
 */
export function figures(weight: number, unit: "lb" | "kg", reps: number) {
  return new RegExp(`${weight}\\s*${unit}\\s*×?\\s*(for\\s*)?${reps}`);
}
