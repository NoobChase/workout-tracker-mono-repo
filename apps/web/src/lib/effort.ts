/*
 * A prescribed set's effort target (step 4a D16): RIR or RPE, stored as
 * written and never both. One typed value for the builder's lines, the
 * workout screen's plan line and `SetRow`, so no screen builds or splits
 * "RIR 2" as a string.
 */

export type EffortScale = "RIR" | "RPE";

export interface EffortTarget {
  scale: EffortScale;
  value: number;
}

/** A set's target from its two columns; `null` with neither. */
export function effortOf(set: {
  targetRir?: number | null;
  targetRpe?: number | null;
}): EffortTarget | null {
  if (set.targetRir != null) return { scale: "RIR", value: set.targetRir };
  if (set.targetRpe != null) return { scale: "RPE", value: set.targetRpe };
  return null;
}

/** "RIR 2", "RPE 8.5": for one-line summaries. */
export function effortText(target: EffortTarget): string {
  return `${target.scale} ${target.value}`;
}
