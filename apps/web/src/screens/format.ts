import type {
  WeightUnit,
  WorkoutContextResponse,
} from "@workout-tracker/shared";

/*
 * The screens' small formatters. US-only product (PRODUCT.md): dates and
 * times are always en-US, in the device's time zone.
 */

const DAY = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
});
const DAY_YEAR = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});
const TIME = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

/** "Mon, Oct 26", with the year only when it isn't this year. */
export function formatDay(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  return date.getFullYear() === now.getFullYear()
    ? DAY.format(date)
    : DAY_YEAR.format(date);
}

/** "9:04 AM". */
export function formatTime(iso: string): string {
  return TIME.format(new Date(iso));
}

export function unitLabel(unit: WeightUnit): "lb" | "kg" {
  return unit === "KG" ? "kg" : "lb";
}

type PlannedExercise = WorkoutContextResponse["exercises"][number];

/** How many sets the plan asks for. */
export function targetSets(planned: PlannedExercise): number {
  return planned.targetSets ?? planned.plannedSets.length;
}

/** "5–8" or "5"; `null` when the plan sets no reps. */
export function repRange(
  min: number | null | undefined,
  max: number | null | undefined,
): string | null {
  if (min == null && max == null) return null;
  if (min == null || max == null || min === max) return String(min ?? max);
  return `${min}–${max}`;
}

/** The rep range of set `n` (1-based), else the exercise's first. */
export function repRangeOf(planned: PlannedExercise, n = 1): string | null {
  const set =
    planned.plannedSets.find((s) => s.setNumber === n) ??
    planned.plannedSets[0];
  return set ? repRange(set.repsMin, set.repsMax) : null;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}
