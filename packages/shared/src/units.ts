import { z } from "zod";
import { entityId } from "./ids.js";

/** Mirrors the `weight_unit` enum in `packages/db`. */
export const weightUnit = z.enum(["LB", "KG"]);
export type WeightUnit = z.infer<typeof weightUnit>;

/**
 * The user's weight units (data-model.md 2.5): their default and the
 * per-exercise overrides, keyed by exercise id. Sent with the workout context
 * and with the exercise catalog, so the builder can prescribe in the lifter's
 * unit outside a workout.
 */
export const unitSettings = z.object({
  default: weightUnit,
  overrides: z.record(entityId, weightUnit),
});
export type UnitSettings = z.infer<typeof unitSettings>;

/**
 * Kilograms in one of each weight unit. A `Record` over the enum, so a new
 * unit fails to compile until it says how it converts.
 */
const KG_PER: Record<WeightUnit, number> = { LB: 0.45359237, KG: 1 };

/** `weight` written in `from`, expressed in `to`. Unrounded. */
export function convertWeight(
  weight: number,
  from: WeightUnit,
  to: WeightUnit,
): number {
  return from === to ? weight : (weight * KG_PER[from]) / KG_PER[to];
}

/** At most `places` decimals, tolerant of binary floating point. */
function decimals(places: number) {
  const scale = 10 ** places;
  return (n: number) => Math.abs(n * scale - Math.round(n * scale)) < 1e-6;
}

/** `NUMERIC(7,2)` with a `>= 0` check: 0 to 99999.99, at most two decimals. */
export const weightValue = z
  .number()
  .min(0)
  .max(99999.99)
  .refine(decimals(2), { message: "at most 2 decimal places" });

/** `SMALLINT` with a `>= 0` check. */
export const repsValue = z.number().int().min(0).max(32767);

/** Sets are numbered from 1 within their session exercise. */
export const setNumber = z.number().int().min(1);

/** Mirrors the `distance_unit` enum in `packages/db`. */
export const distanceUnit = z.enum(["MI", "KM", "M", "FT"]);
export type DistanceUnit = z.infer<typeof distanceUnit>;

/** `NUMERIC(9,3)` with a `>= 0` check: 0 to 999999.999, at most three decimals. */
export const distanceValue = z
  .number()
  .min(0)
  .max(999999.999)
  .refine(decimals(3), { message: "at most 3 decimal places" });

/** `INTEGER` seconds with a `>= 0` check. */
export const durationSeconds = z.number().int().min(0).max(2147483647);

/** Effort targets are written in half steps: 7, 7.5, 8. */
const halfSteps = (n: number) => Math.abs(n * 2 - Math.round(n * 2)) < 1e-6;

/**
 * A prescribed set's RPE target (`planned_sets.target_rpe`, `NUMERIC(3,1)`):
 * 1 to 10 in steps of 0.5. The database's check allows 0 to 10; the contract
 * is narrower because RPE starts at 1 (step-4a design D16).
 */
export const rpeValue = z
  .number()
  .min(1)
  .max(10)
  .refine(halfSteps, { message: "RPE goes in steps of 0.5" });

/**
 * A prescribed set's reps-in-reserve target (`planned_sets.target_rir`,
 * `NUMERIC(3,1)`): 0 to 10 in steps of 0.5 (step-4a design D16).
 */
export const rirValue = z
  .number()
  .min(0)
  .max(10)
  .refine(halfSteps, { message: "RIR goes in steps of 0.5" });

/** A `SMALLINT` count or ordinal that must be at least `min`. */
export const smallint = (min: number) => z.number().int().min(min).max(32767);
