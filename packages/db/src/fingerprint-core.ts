// The cycle normalizer (operations.md 3.8; step-4a design D6), as pure
// functions with no database or Drizzle import, so any process that holds a
// cycle tree -- the services, the web e2e fake API -- normalizes it the same
// way (`@workout-tracker/db/fingerprint`). Only `node:crypto` is imported.
//
// One normalizer decides what counts as *authoring* a cycle, and it runs over
// both a stored cycle and an in-memory tree, so the two always agree:
//
// - `createProgram` and `copyProgram` replays compare a stored cycle 1 with
//   the request's or the source's (D3, D17);
// - the apply preview and `saveCycle`'s stale guard compare cycles with each
//   other and with the desired tree (D7).
//
// Included in the fingerprint, and nothing else:
//   workouts          name, position
//   planned_exercises exercise_id or placeholder_label, position, target_sets,
//                     group_key (renumbered by first appearance per workout)
//   planned_sets      set_number and every target column: target_reps_min,
//                     target_reps_max, target_weight, weight_unit,
//                     target_duration_seconds, target_distance, distance_unit,
//                     target_rpe, target_rir (D16: RPE 8 and RIR 8 are
//                     different targets, so each is its own key)
//
// Excluded on purpose:
//   every `notes` column       annotating a cycle is not authoring it (3.8);
//                              `cycleContentKey` adds them back
//   workout_plans name/notes   `clonePlan` over an existing plan leaves the
//                              plan row alone, so including them would make an
//                              applied cycle never match its source (D7)
//   target_weight_kg           generated from target_weight + weight_unit
//   ids, parent ids            a clone has fresh ids and is still the same
//
// A migration that touches `workouts` or any `planned_*` table must update
// this file and test/fingerprint.test.ts (the `schema-change` skill says so).
import { createHash } from "node:crypto";

/** The `weight_unit` enum; `fingerprint.ts` checks it against schema.ts. */
export type WeightUnit = "LB" | "KG";
/** The `distance_unit` enum; `fingerprint.ts` checks it against schema.ts. */
export type DistanceUnit = "MI" | "KM" | "M" | "FT";

/**
 * A `numeric` column's value: a number, or decimal text ("135.00"). Both
 * normalize the same.
 */
export type Decimal = string | number;

// --- The normalizer's input --------------------------------------------------
//
// One cycle (a `workout_plans` row) and its subtree, as loosely as anything
// may hand it in: field names are the Drizzle field names of schema.ts, ids
// and every nullable column optional (absent reads as null), numerics as
// `Decimal`. A stored tree (`StoredCycleTree`) and a request tree both fit.

export interface FingerprintInputSet {
  id?: string;
  setNumber: number;
  targetRepsMin?: number | null;
  targetRepsMax?: number | null;
  targetWeight?: Decimal | null;
  weightUnit?: WeightUnit | null;
  targetDurationSeconds?: number | null;
  targetDistance?: Decimal | null;
  distanceUnit?: DistanceUnit | null;
  targetRpe?: Decimal | null;
  targetRir?: Decimal | null;
  notes?: string | null;
}

/** A slot: an exercise or a placeholder label, never both. */
export interface FingerprintInputSlot {
  id?: string;
  exerciseId?: string | null;
  placeholderLabel?: string | null;
  position: number;
  targetSets?: number | null;
  /** NULL = standalone; equal values within a workout = one superset. */
  groupKey?: number | null;
  notes?: string | null;
  plannedSets: FingerprintInputSet[];
}

export interface FingerprintInputWorkout {
  id?: string;
  name: string;
  position: number;
  notes?: string | null;
  plannedExercises: FingerprintInputSlot[];
}

export interface FingerprintInput {
  /** The `workout_plans` id. */
  id?: string;
  name?: string | null;
  notes?: string | null;
  workouts: FingerprintInputWorkout[];
}

// --- Fingerprint and content key ---------------------------------------------

/**
 * SHA-256 (hex) of the cycle's authored content. Two cycles with the same
 * fingerprint are the same authored cycle, whatever their ids and notes.
 */
export function cycleFingerprint(cycle: FingerprintInput): string {
  return createHash("sha256")
    .update(canonicalJson(normalizeCycle(cycle, { notes: false })))
    .digest("hex");
}

/**
 * The fingerprint's content plus every workout, slot and set `notes` column
 * (the plan row's name and notes stay out, as in the fingerprint): "is this
 * cycle exactly that one, apart from ids?" Equal keys mean a clone of one
 * over the other would write the same content. Compared, never stored.
 */
export function cycleContentKey(cycle: FingerprintInput): string {
  return canonicalJson(normalizeCycle(cycle, { notes: true }));
}

/** JSON with object keys sorted at every depth: deep equality as a string. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : v,
  );
}

// --- The normalizer ------------------------------------------------------------
//
// The only place that decides what a cycle *is* for comparison. Every included
// column is listed by name; adding a column to a plan table means adding it
// here, deliberately, as included or excluded.

interface NormalizeOptions {
  /** Include every workout, slot and set `notes` column. */
  notes: boolean;
}

// The `numeric` scales in schema.ts. A request value is rounded the way
// Postgres rounds it on insert, so a tree and the rows it becomes agree.
const SCALE = {
  targetWeight: 2,
  targetDistance: 3,
  targetRpe: 1,
  targetRir: 1,
} as const;

function normalizeCycle(
  cycle: FingerprintInput,
  options: NormalizeOptions,
): unknown {
  const notes = (value: string | null | undefined) =>
    options.notes ? { notes: value ?? null } : {};
  return {
    workouts: sortRows(
      cycle.workouts.map((w) => ({
        name: w.name,
        position: w.position,
        ...notes(w.notes),
        plannedExercises: normalizeSlots(w.plannedExercises, notes),
      })),
      (w) => w.position,
    ),
  };
}

function normalizeSlots(
  slots: readonly FingerprintInputSlot[],
  notes: (value: string | null | undefined) => object,
) {
  const rows = sortRows(
    slots.map((pe) => ({
      exerciseId: pe.exerciseId?.toLowerCase() ?? null,
      placeholderLabel: pe.placeholderLabel ?? null,
      position: pe.position,
      targetSets: pe.targetSets ?? null,
      groupKey: pe.groupKey ?? null,
      ...notes(pe.notes),
      plannedSets: sortRows(
        pe.plannedSets.map((s) => ({
          setNumber: s.setNumber,
          targetRepsMin: s.targetRepsMin ?? null,
          targetRepsMax: s.targetRepsMax ?? null,
          targetWeight: decimal(s.targetWeight, SCALE.targetWeight),
          weightUnit: s.weightUnit ?? null,
          targetDurationSeconds: s.targetDurationSeconds ?? null,
          targetDistance: decimal(s.targetDistance, SCALE.targetDistance),
          distanceUnit: s.distanceUnit ?? null,
          targetRpe: decimal(s.targetRpe, SCALE.targetRpe),
          targetRir: decimal(s.targetRir, SCALE.targetRir),
          ...notes(s.notes),
        })),
        (s) => s.setNumber,
      ),
    })),
    (pe) => pe.position,
  );
  // Group keys only say "these slots go together": renumber 1, 2, ... by first
  // appearance in position order, so {1,1} and {7,7} are the same superset.
  const renumbered = new Map<number, number>();
  return rows.map((pe) => {
    if (pe.groupKey === null) return pe;
    if (!renumbered.has(pe.groupKey)) {
      renumbered.set(pe.groupKey, renumbered.size + 1);
    }
    return { ...pe, groupKey: renumbered.get(pe.groupKey)! };
  });
}

/**
 * Sorted by the row's natural key, ties (which a valid cycle never has) broken
 * by content, so input order never changes the result.
 */
function sortRows<T>(rows: T[], key: (row: T) => number): T[] {
  return rows
    .map((row) => ({ row, k: key(row), s: canonicalJson(row) }))
    .sort((a, b) => a.k - b.k || (a.s < b.s ? -1 : a.s > b.s ? 1 : 0))
    .map((r) => r.row);
}

/**
 * A `numeric` value as its shortest exact decimal string, rounded half away
 * from zero to the column's scale (as Postgres does): 135, "135" and "135.00"
 * are all "135". Strings are handled as decimal text, never through a float.
 */
function decimal(
  value: Decimal | null | undefined,
  scale: number,
): string | null {
  if (value === null || value === undefined) return null;
  let text: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`not a finite decimal: ${value}`);
    }
    text = String(value);
    // Below 1e21, toFixed never uses exponent notation.
    if (/e/i.test(text)) text = value.toFixed(scale + 1);
  } else {
    text = value.trim();
  }
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text);
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) {
    throw new TypeError(`not a decimal: ${JSON.stringify(value)}`);
  }
  let int = m[2] || "0";
  let frac = m[3] ?? "";
  if (frac.length > scale) {
    const roundUp = frac[scale]! >= "5";
    frac = frac.slice(0, scale);
    if (roundUp) {
      const digits = (BigInt(int + frac) + 1n)
        .toString()
        .padStart(scale + 1, "0");
      int = scale === 0 ? digits : digits.slice(0, -scale);
      frac = scale === 0 ? "" : digits.slice(-scale);
    }
  }
  int = int.replace(/^0+(?=\d)/, "");
  frac = frac.replace(/0+$/, "");
  const negative = m[1] === "-" && (int !== "0" || frac !== "");
  return `${negative ? "-" : ""}${int}${frac ? `.${frac}` : ""}`;
}
