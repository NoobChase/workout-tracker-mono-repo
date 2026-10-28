// Small pieces more than one service needs: wire conversions and the
// "resolved workout" condition that what's-next and finishing must agree on.
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  sessionSets,
  workoutSessions,
  workouts,
  type Executor,
  type UserScope,
} from "@workout-tracker/db";

/** `NUMERIC` comes back from the driver as a string; the wire wants a number. */
export function toNumber(value: string | null): number | null {
  return value === null ? null : Number(value);
}

export function toIso(value: Date): string {
  return value.toISOString();
}

/**
 * A session that resolves the outer query's `workouts` row: COMPLETED or
 * SKIPPED (operations.md 4.1, 4.13). `IN_PROGRESS` is deliberately absent --
 * an abandoned session leaves its workout next. Use as `notExists(...)` in a
 * query over `workouts`; what's-next and the finish's exhaustion check must
 * agree on it, so both call this.
 */
export function resolvingSession(db: Executor, scope: UserScope) {
  return db
    .select({ one: sql`1` })
    .from(workoutSessions)
    .where(
      and(
        scope.workoutSessions,
        eq(workoutSessions.workoutId, workouts.id),
        inArray(workoutSessions.status, ["COMPLETED", "SKIPPED"]),
      ),
    );
}

/** The columns every service returns a logged set with. */
export const loggedSetColumns = {
  id: sessionSets.id,
  sessionExerciseId: sessionSets.sessionExerciseId,
  setNumber: sessionSets.setNumber,
  reps: sessionSets.reps,
  weight: sessionSets.weight,
  weightUnit: sessionSets.weightUnit,
  kind: sessionSets.kind,
  loggedAt: sessionSets.loggedAt,
};

export interface LoggedSet {
  id: string;
  sessionExerciseId: string;
  setNumber: number;
  reps: number | null;
  weight: number | null;
  weightUnit: "LB" | "KG" | null;
  kind: "NORMAL" | "WARMUP" | "DROP";
  loggedAt: string;
}

export function toLoggedSet(row: {
  id: string;
  sessionExerciseId: string;
  setNumber: number;
  reps: number | null;
  weight: string | null;
  weightUnit: "LB" | "KG" | null;
  kind: "NORMAL" | "WARMUP" | "DROP";
  loggedAt: Date;
}): LoggedSet {
  return {
    ...row,
    weight: toNumber(row.weight),
    loggedAt: toIso(row.loggedAt),
  };
}
