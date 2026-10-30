import { convertWeight, type WeightUnit } from "@workout-tracker/shared";
import { effortOf, type EffortTarget } from "@/lib/effort";
import type { ExerciseView } from "../../local/session-view.js";
import { plural, targetSets } from "../format.js";

/*
 * What the workout screen reads off the plan, as pure functions: what the
 * steppers start at for the next set, a set's prescribed weight and effort
 * target, where to pick up, and how an exercise stands in Today's log.
 */

/** The steppers' values: `null` until there's a number to offer. */
export type Values = { weight: number | null; reps: number | null };

/** The steppers' steps and ceilings, per unit. */
export const WEIGHT_STEP: Record<WeightUnit, number> = { LB: 5, KG: 2.5 };
export const MAX_WEIGHT: Record<WeightUnit, number> = { LB: 2000, KG: 1000 };
export const MAX_REPS = 100;

/** The smallest change a bar takes: a whole lb, a half kg. */
const LOADABLE: Record<WeightUnit, number> = { LB: 1, KG: 0.5 };

/**
 * The seed for the next set. Weight: the plan's prescribed weight for this
 * set first (the plan is the plan: a written deload beats last time, which
 * still shows inline), else the last set logged that the server hasn't
 * refused (a rejected number is never offered again), else last time's same
 * set, else its first, else blank. Reps: never below the plan's floor for
 * this set: the higher of last time's same set and the floor; with no floor,
 * last time's same set, else the last good set, else the plan's ceiling.
 */
export function seed(exercise: ExerciseView): Values {
  const good = exercise.sets.filter((s) => s.sync.state !== "rejected").at(-1);
  const n = exercise.sets.length + 1;
  const last = exercise.planned.lastTime?.sets;
  const sameSet = last?.find((s) => s.setNumber === n);
  const plan =
    exercise.planned.plannedSets.find((s) => s.setNumber === n) ??
    exercise.planned.plannedSets[0];
  return {
    weight:
      prescribedWeight(exercise, n) ??
      good?.weight ??
      sameSet?.weight ??
      last?.[0]?.weight ??
      null,
    reps:
      plan?.repsMin != null
        ? Math.max(sameSet?.reps ?? 0, plan.repsMin)
        : (sameSet?.reps ?? good?.reps ?? plan?.repsMax ?? null),
  };
}

/**
 * Set `n`'s prescribed weight in the unit this session logs the exercise in,
 * or null when the plan leaves it open. A weight written in the other unit
 * (an override changed since it was prescribed) is converted and rounded to
 * a loadable number: a whole lb, a half kg.
 */
export function prescribedWeight(
  exercise: ExerciseView,
  n: number,
): number | null {
  const set = exercise.planned.plannedSets.find((s) => s.setNumber === n);
  if (set?.weight == null) return null;
  const from = set.weightUnit ?? exercise.unit;
  if (from === exercise.unit) return set.weight;
  const step = LOADABLE[exercise.unit];
  return (
    Math.round(convertWeight(set.weight, from, exercise.unit) / step) * step
  );
}

/** Set `n`'s effort target as the plan wrote it, or null. */
export function effortAt(
  planned: ExerciseView["planned"],
  n: number,
): EffortTarget | null {
  const set = planned.plannedSets.find((s) => s.setNumber === n);
  return set ? effortOf(set) : null;
}

/** Where to pick up: the exercise in progress, else the one after the last touched. */
export function defaultCurrent(exercises: readonly ExerciseView[]): number {
  let lastTouched = -1;
  exercises.forEach((e, i) => {
    if (e.sets.length > 0) lastTouched = i;
  });
  if (lastTouched < 0) return 0;
  const touched = exercises[lastTouched]!;
  if (touched.sets.length < targetSets(touched.planned)) return lastTouched;
  return Math.min(lastTouched + 1, exercises.length - 1);
}

/**
 * How an exercise stands in Today's log: sets logged of the target, planned,
 * or skipped once the lifter has moved past it (or the workout is over). A
 * slot the logger can't take yet says so instead.
 */
export function exerciseStatus(
  exercise: ExerciseView,
  { passed, inProgress }: { passed: boolean; inProgress: boolean },
): string {
  const target = targetSets(exercise.planned);
  const behind = passed || !inProgress;
  if (!exercise.loggable) return behind ? "skipped" : "logging arrives soon";
  if (exercise.sets.length > 0) {
    return `${exercise.sets.length} of ${target} ${plural(target, "set")}`;
  }
  return behind ? "skipped" : `${target} ${plural(target, "set")} planned`;
}
