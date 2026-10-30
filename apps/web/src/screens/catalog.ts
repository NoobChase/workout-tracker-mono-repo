import {
  equipment as equipmentEnum,
  metricKind,
  muscleGroup,
  type Equipment,
  type ExerciseListItem,
  type MetricKind,
  type MuscleGroup,
} from "@workout-tracker/shared";

/*
 * The exercise catalog as the picker and the catalog screen show it (spec
 * `exercise-catalog`; design D11): fetched whole, filtered here on the
 * device by name, muscle and equipment in any combination.
 */

export const MUSCLES = muscleGroup.options;
export const EQUIPMENT = equipmentEnum.options;
export const METRICS = metricKind.options;

const WORDS: Record<string, string> = {
  EZ_BAR: "EZ bar",
  CARDIO_MACHINE: "Cardio machine",
  FRONT_DELTS: "Front delts",
  SIDE_DELTS: "Side delts",
  REAR_DELTS: "Rear delts",
  ABS: "Abs",
};

/** "UPPER_BACK" -> "Upper back"; a few read better spelled out. */
export function enumWords(value: MuscleGroup | Equipment): string {
  const known = WORDS[value];
  if (known) return known;
  const words = value.toLowerCase().replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export const METRIC_WORDS: Record<MetricKind, string> = {
  REPS: "Reps",
  WEIGHT: "Weight",
  DURATION: "Time",
  DISTANCE: "Distance",
  COMPLETED: "Done or not",
  RPE: "RPE",
};

export interface CatalogFilter {
  query: string;
  muscle: MuscleGroup | null;
  equipment: Equipment | null;
  /** The catalog screen's "Show retired"; pickers never show them. */
  showRetired: boolean;
}

export const NO_FILTER: CatalogFilter = {
  query: "",
  muscle: null,
  equipment: null,
  showRetired: false,
};

/**
 * The list narrowed by every filter at once, by name (the server already
 * orders it). The name search is case-insensitive and matches anywhere; the
 * muscle filter matches primary or secondary muscles.
 */
export function filterExercises(
  list: readonly ExerciseListItem[],
  filter: CatalogFilter,
): ExerciseListItem[] {
  const query = filter.query.trim().toLowerCase();
  return list.filter(
    (e) =>
      (filter.showRetired || e.isActive) &&
      (query === "" || e.name.toLowerCase().includes(query)) &&
      (filter.muscle === null ||
        e.primaryMuscles.includes(filter.muscle) ||
        e.secondaryMuscles.includes(filter.muscle)) &&
      (filter.equipment === null || e.equipment === filter.equipment),
  );
}

/** "Quads, glutes · Barbell": what a row says under the name. */
export function exerciseMeta(e: ExerciseListItem): string {
  const muscles = e.primaryMuscles.map((m) => enumWords(m).toLowerCase());
  const head = muscles.length
    ? muscles[0]!.charAt(0).toUpperCase() + muscles.join(", ").slice(1)
    : null;
  return [head, e.equipment ? enumWords(e.equipment) : null]
    .filter(Boolean)
    .join(" · ");
}

/** "Reps, weight (optional)". */
export function metricsText(e: Pick<ExerciseListItem, "metrics">): string {
  return e.metrics
    .map(
      (m, i) =>
        `${i === 0 ? METRIC_WORDS[m.metric] : METRIC_WORDS[m.metric].toLowerCase()}${m.isRequired ? "" : " (optional)"}`,
    )
    .join(", ");
}

/**
 * The ids most recently picked on this device, newest first. A convenience
 * list for the picker's "Recently used", kept in localStorage (every access
 * guarded: private modes refuse storage).
 */
const RECENT_KEY = "tanren-recent-exercises";
const RECENT_MAX = 8;

export function readRecent(userId: string | null): string[] {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(`${RECENT_KEY}:${userId}`);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

export function rememberRecent(userId: string | null, exerciseId: string) {
  if (!userId) return;
  const next = [
    exerciseId,
    ...readRecent(userId).filter((x) => x !== exerciseId),
  ];
  try {
    localStorage.setItem(
      `${RECENT_KEY}:${userId}`,
      JSON.stringify(next.slice(0, RECENT_MAX)),
    );
  } catch {
    // Storage refused: the list is a convenience, nothing is lost.
  }
}
