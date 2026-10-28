// "What's next?" (operations.md 4.1, data-model.md 5) and the per-workout
// context the logger prefetches (design D9). Both are pure reads; the
// write-path extension in finishWorkout is what guarantees what's-next always
// finds a cycle.
import { and, asc, desc, eq, inArray, isNotNull, notExists } from "drizzle-orm";
import {
  countsAsSet,
  exerciseMetrics,
  exercises,
  plannedExercises,
  plannedSets,
  sessionExercises,
  sessionSets,
  userExerciseSettings,
  userScope,
  users,
  workoutPlans,
  workoutPrograms,
  workoutSessions,
  workouts,
  type Db,
  type UserId,
} from "@workout-tracker/db";
import type {
  WeightUnit,
  WhatsNextResponse,
  WorkoutContextResponse,
} from "@workout-tracker/shared";
import { notFound } from "./errors";
import { resolvingSession, toIso, toNumber } from "./rows";

/**
 * One row per ACTIVE program -- its earliest workout (by cycle, then
 * position) with no COMPLETED or SKIPPED session -- plus every IN_PROGRESS
 * session, for the resume banner.
 */
export async function whatsNext(
  db: Db,
  user: UserId,
): Promise<WhatsNextResponse> {
  const scope = userScope(user);

  const next = await db
    .selectDistinctOn([workoutPrograms.id], {
      programId: workoutPrograms.id,
      programName: workoutPrograms.name,
      workoutId: workouts.id,
      workoutName: workouts.name,
      cycleNumber: workoutPlans.cycleNumber,
    })
    .from(workoutPrograms)
    .innerJoin(workoutPlans, eq(workoutPlans.programId, workoutPrograms.id))
    .innerJoin(workouts, eq(workouts.planId, workoutPlans.id))
    .where(
      and(
        scope.workoutPrograms,
        eq(workoutPrograms.status, "ACTIVE"),
        notExists(resolvingSession(db, scope)),
      ),
    )
    .orderBy(workoutPrograms.id, workoutPlans.cycleNumber, workouts.position);

  const inProgress = await db
    .select({
      sessionId: workoutSessions.id,
      workoutId: workouts.id,
      workoutName: workouts.name,
      programName: workoutPrograms.name,
      performedAt: workoutSessions.performedAt,
    })
    .from(workoutSessions)
    .innerJoin(workouts, eq(workouts.id, workoutSessions.workoutId))
    .innerJoin(workoutPlans, eq(workoutPlans.id, workouts.planId))
    .innerJoin(workoutPrograms, eq(workoutPrograms.id, workoutPlans.programId))
    .where(
      and(
        scope.workoutSessions,
        scope.workouts,
        eq(workoutSessions.status, "IN_PROGRESS"),
      ),
    )
    .orderBy(desc(workoutSessions.performedAt), desc(workoutSessions.id));

  return {
    next,
    inProgress: inProgress.map((s) => ({
      ...s,
      performedAt: toIso(s.performedAt),
    })),
  };
}

/**
 * Everything the logger needs to train `workoutId` with no signal (design
 * D9): the planned exercises and sets, the exercises' names and metrics, the
 * user's unit settings, and for each exercise the sets that counted in the
 * most recent COMPLETED session containing it, from any workout.
 *
 * Placeholder slots (no exercise yet) are omitted: templates have none, and
 * filling one is out of scope for step 3.
 */
export async function getWorkoutContext(
  db: Db,
  user: UserId,
  workoutId: string,
): Promise<WorkoutContextResponse> {
  const scope = userScope(user);

  const [workout] = await db
    .select({
      id: workouts.id,
      name: workouts.name,
      position: workouts.position,
      cycleNumber: workoutPlans.cycleNumber,
      programId: workoutPrograms.id,
      programName: workoutPrograms.name,
    })
    .from(workouts)
    .innerJoin(workoutPlans, eq(workoutPlans.id, workouts.planId))
    .innerJoin(workoutPrograms, eq(workoutPrograms.id, workoutPlans.programId))
    .where(and(scope.workouts, eq(workouts.id, workoutId)));
  if (!workout) throw notFound("That workout doesn't exist.");

  const planned = await db
    .select({
      plannedExerciseId: plannedExercises.id,
      position: plannedExercises.position,
      exerciseId: exercises.id,
      name: exercises.name,
      targetSets: plannedExercises.targetSets,
    })
    .from(plannedExercises)
    .innerJoin(exercises, eq(exercises.id, plannedExercises.exerciseId))
    .where(
      and(scope.plannedExercises, eq(plannedExercises.workoutId, workoutId)),
    )
    .orderBy(plannedExercises.position);

  const plannedIds = planned.map((p) => p.plannedExerciseId);
  const exerciseIds = [...new Set(planned.map((p) => p.exerciseId))];

  const [metrics, sets, units, lastTime] = await Promise.all([
    exerciseIds.length === 0
      ? []
      : db
          .select({
            exerciseId: exerciseMetrics.exerciseId,
            metric: exerciseMetrics.metric,
          })
          .from(exerciseMetrics)
          .where(inArray(exerciseMetrics.exerciseId, exerciseIds))
          .orderBy(exerciseMetrics.metric),
    plannedIds.length === 0
      ? []
      : db
          .select({
            plannedExerciseId: plannedSets.plannedExerciseId,
            setNumber: plannedSets.setNumber,
            repsMin: plannedSets.targetRepsMin,
            repsMax: plannedSets.targetRepsMax,
            weight: plannedSets.targetWeight,
            weightUnit: plannedSets.weightUnit,
          })
          .from(plannedSets)
          .where(
            and(
              scope.plannedSets,
              inArray(plannedSets.plannedExerciseId, plannedIds),
            ),
          )
          .orderBy(plannedSets.setNumber),
    unitSettings(db, user),
    lastCompleted(db, user, exerciseIds),
  ]);

  return {
    workout,
    units,
    exercises: planned.map((p) => ({
      ...p,
      metrics: metrics
        .filter((m) => m.exerciseId === p.exerciseId)
        .map((m) => m.metric),
      plannedSets: sets
        .filter((s) => s.plannedExerciseId === p.plannedExerciseId)
        .map(({ plannedExerciseId: _, weight, ...s }) => ({
          ...s,
          weight: toNumber(weight),
        })),
      lastTime: lastTime.get(p.exerciseId) ?? null,
    })),
  };
}

/** The user's default unit and per-exercise overrides (data-model.md 2.5). */
async function unitSettings(db: Db, user: UserId) {
  // `users` is keyed by the user id itself; there is no chain to scope.
  const [row] = await db
    .select({ unit: users.defaultWeightUnit })
    .from(users)
    .where(eq(users.id, user));
  if (!row) throw notFound("Your account doesn't exist.");
  const overrides = await db
    .select({
      exerciseId: userExerciseSettings.exerciseId,
      unit: userExerciseSettings.defaultWeightUnit,
    })
    .from(userExerciseSettings)
    .where(
      and(
        userScope(user).userExerciseSettings,
        isNotNull(userExerciseSettings.defaultWeightUnit),
      ),
    );
  return {
    default: row.unit,
    overrides: Object.fromEntries(
      overrides.map((o) => [o.exerciseId, o.unit as WeightUnit]),
    ),
  };
}

type LastTime = NonNullable<
  WorkoutContextResponse["exercises"][number]["lastTime"]
>;

/**
 * Per exercise: the most recent COMPLETED session (by performed_at, then id)
 * with a session exercise for it, and that row's sets that count, in order.
 * When a session has the exercise twice, the first by position is used.
 */
async function lastCompleted(
  db: Db,
  user: UserId,
  exerciseIds: readonly string[],
): Promise<Map<string, LastTime>> {
  const out = new Map<string, LastTime>();
  if (exerciseIds.length === 0) return out;
  const scope = userScope(user);

  const latest = await db
    .selectDistinctOn([sessionExercises.exerciseId], {
      exerciseId: sessionExercises.exerciseId,
      sessionExerciseId: sessionExercises.id,
      sessionId: workoutSessions.id,
      performedAt: workoutSessions.performedAt,
    })
    .from(sessionExercises)
    .innerJoin(
      workoutSessions,
      eq(workoutSessions.id, sessionExercises.sessionId),
    )
    .where(
      and(
        scope.workoutSessions,
        eq(workoutSessions.status, "COMPLETED"),
        inArray(sessionExercises.exerciseId, [...exerciseIds]),
      ),
    )
    .orderBy(
      sessionExercises.exerciseId,
      desc(workoutSessions.performedAt),
      desc(workoutSessions.id),
      asc(sessionExercises.position),
    );
  if (latest.length === 0) return out;

  const sets = await db
    .select({
      sessionExerciseId: sessionSets.sessionExerciseId,
      setNumber: sessionSets.setNumber,
      reps: sessionSets.reps,
      weight: sessionSets.weight,
      weightUnit: sessionSets.weightUnit,
    })
    .from(sessionSets)
    .where(
      and(
        scope.sessionSets,
        countsAsSet,
        inArray(
          sessionSets.sessionExerciseId,
          latest.map((l) => l.sessionExerciseId),
        ),
      ),
    )
    .orderBy(sessionSets.setNumber);

  for (const l of latest) {
    out.set(l.exerciseId, {
      sessionId: l.sessionId,
      performedAt: toIso(l.performedAt),
      sets: sets
        .filter((s) => s.sessionExerciseId === l.sessionExerciseId)
        .map(({ sessionExerciseId: _, weight, ...s }) => ({
          ...s,
          weight: toNumber(weight),
        })),
    });
  }
  return out;
}
