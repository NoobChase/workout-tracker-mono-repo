import type {
  WeightUnit,
  WorkoutContextResponse,
} from "@workout-tracker/shared";

/**
 * The unit a new set is stamped with, resolved on the device from the settings
 * cached with the workout's context: the per-exercise override first, the
 * user's default second (data-model §2.5, operations.md §4.3). The server
 * applies the same rule only when a write arrives without a unit.
 */
export function resolveUnit(
  units: WorkoutContextResponse["units"],
  exerciseId: string,
): WeightUnit {
  return units.overrides[exerciseId] ?? units.default;
}
