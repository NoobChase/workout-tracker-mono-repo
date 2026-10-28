import type {
  WeightUnit,
  WorkoutContextResponse,
} from "@workout-tracker/shared";
import type { LocalSession, LocalSet } from "./sessions.js";
import { rowSync, type RowSync } from "./sync-state.js";
import { resolveUnit } from "./units.js";

type PlannedExercise = WorkoutContextResponse["exercises"][number];

export interface SetView extends LocalSet {
  sync: RowSync;
}

export interface ExerciseView {
  /** The plan: targets, rep ranges and last time's numbers (design D9). */
  planned: PlannedExercise;
  /** The unit the next set will be stamped with, override first. */
  unit: WeightUnit;
  /** `null` until the first set: no row means skipped. */
  sessionExerciseId: string | null;
  /** The sets as logged in this session, in order, with their sync state. */
  sets: SetView[];
}

export interface SessionView {
  sessionId: string;
  workoutId: string;
  status: LocalSession["status"];
  performedAt: string;
  finishedAt: string | null;
  workout: WorkoutContextResponse["workout"];
  /** The session's own start or finish delivery. */
  sync: RowSync;
  /** Every planned exercise in plan order, beside what was logged. */
  exercises: ExerciseView[];
}

export function buildSessionView(
  record: LocalSession,
  rows: Map<string, RowSync>,
): SessionView {
  return {
    sessionId: record.sessionId,
    workoutId: record.workoutId,
    status: record.status,
    performedAt: record.performedAt,
    finishedAt: record.finishedAt,
    workout: record.context.workout,
    sync: rowSync(rows, record.sessionId),
    exercises: [...record.context.exercises]
      .sort((a, b) => a.position - b.position)
      .map((planned) => {
        const entry = record.exercises.find(
          (e) => e.plannedExerciseId === planned.plannedExerciseId,
        );
        return {
          planned,
          unit: resolveUnit(record.context.units, planned.exerciseId),
          sessionExerciseId: entry?.id ?? null,
          sets: (entry?.sets ?? []).map((s) => ({
            ...s,
            sync: rowSync(rows, s.id),
          })),
        };
      }),
  };
}
