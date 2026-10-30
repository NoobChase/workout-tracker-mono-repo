import type { WorkoutContextResponse } from "@workout-tracker/shared";

type PlannedSlot = WorkoutContextResponse["exercises"][number];

/**
 * Whether the logger can log sets against a slot yet (step 4a design D12):
 * an exercise whose metrics are exactly reps and weight. A placeholder, a
 * timed or distance exercise, or anything else shows as "Logging this
 * arrives soon" with Skip, and takes no sets. Metric names are compared
 * without case: the API sends the enum ("REPS"); contexts a step-3 device
 * cached may hold another spelling.
 */
export function isLoggable(slot: PlannedSlot): boolean {
  if (slot.exerciseId === null) return false;
  const metrics = new Set(slot.metrics.map((m) => m.toUpperCase()));
  return metrics.size === 2 && metrics.has("REPS") && metrics.has("WEIGHT");
}

/**
 * What a slot is called, everywhere one is named (the workout screen, home's
 * previews, the builder's rows, picker title and Undo toast): its exercise's
 * name, else its placeholder label. A builder slot knows only its exercise
 * id, so it passes the name it looked up.
 */
export function nameOf(slot: {
  name: string | null;
  placeholderLabel?: string | null;
}): string {
  return slot.name ?? slot.placeholderLabel ?? "Placeholder";
}
