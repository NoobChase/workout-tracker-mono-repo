import { z } from "zod";
import { entityId, isoDateTime, uuidV7 } from "./ids.js";
import { repsValue, setNumber, weightUnit, weightValue } from "./units.js";

/** `GET /next`: one workout per active program, plus resumable sessions. */
export const whatsNextResponse = z.object({
  next: z.array(
    z.object({
      programId: entityId,
      programName: z.string(),
      workoutId: entityId,
      workoutName: z.string(),
      cycleNumber: z.number().int().min(1),
    }),
  ),
  inProgress: z.array(
    z.object({
      sessionId: entityId,
      workoutId: entityId,
      workoutName: z.string(),
      programName: z.string(),
      performedAt: isoDateTime,
    }),
  ),
});
export type WhatsNextResponse = z.infer<typeof whatsNextResponse>;

/** `GET /workouts/:id/context`: everything the logger needs, prefetched for offline. */
export const workoutContextResponse = z.object({
  workout: z.object({
    id: entityId,
    name: z.string(),
    position: z.number().int().min(0),
    cycleNumber: z.number().int().min(1),
    programId: entityId,
    programName: z.string(),
  }),
  units: z.object({
    default: weightUnit,
    overrides: z.record(entityId, weightUnit),
  }),
  exercises: z.array(
    z.object({
      plannedExerciseId: entityId,
      position: z.number().int().min(0),
      exerciseId: entityId,
      name: z.string(),
      metrics: z.array(z.string()),
      targetSets: z.number().int().nullable(),
      plannedSets: z.array(
        z.object({
          setNumber,
          repsMin: z.number().int().nullable(),
          repsMax: z.number().int().nullable(),
          weight: weightValue.nullable(),
          weightUnit: weightUnit.nullable(),
        }),
      ),
      lastTime: z
        .object({
          sessionId: entityId,
          performedAt: isoDateTime,
          sets: z.array(
            z.object({
              setNumber,
              reps: repsValue.nullable(),
              weight: weightValue.nullable(),
              weightUnit: weightUnit.nullable(),
            }),
          ),
        })
        .nullable(),
    }),
  ),
});
export type WorkoutContextResponse = z.infer<typeof workoutContextResponse>;

/** `PUT /sessions/:id` (the id is the path parameter, minted by the client). */
export const startWorkoutRequest = z.object({
  workoutId: entityId,
  performedAt: isoDateTime,
});
export type StartWorkoutRequest = z.infer<typeof startWorkoutRequest>;

/** `PUT /sessions/:id` response: the stored session, the same on every replay. */
export const startedSession = z.object({
  id: entityId,
  workoutId: entityId,
  status: z.enum(["IN_PROGRESS", "COMPLETED", "SKIPPED"]),
  performedAt: isoDateTime,
});
export type StartedSession = z.infer<typeof startedSession>;

/**
 * `PUT /sets/:id`. Carries its session exercise so the first set of an exercise
 * is one request (operations.md 4.3). Step 3 logs weighted, rep-based sets only,
 * so `reps` and `weight` are both required. `weightUnit` is the unit the device
 * resolved; when absent the server resolves it.
 */
export const logSetRequest = z.object({
  sessionExercise: z.object({
    id: uuidV7,
    sessionId: uuidV7,
    exerciseId: entityId,
    plannedExerciseId: entityId.nullable(),
    position: z.number().int().min(0),
  }),
  setNumber,
  reps: repsValue,
  weight: weightValue,
  weightUnit: weightUnit.optional(),
  loggedAt: isoDateTime,
});
export type LogSetRequest = z.infer<typeof logSetRequest>;

/** `PATCH /sets/:id`: absolute values, so a replay is harmless. */
export const editSetRequest = z.object({
  reps: repsValue,
  weight: weightValue,
  weightUnit: weightUnit.optional(),
});
export type EditSetRequest = z.infer<typeof editSetRequest>;

/** `POST /sessions/:id/finish`. `extended` is true when this call added a cycle. */
export const finishWorkoutResponse = z.object({
  sessionId: entityId,
  status: z.literal("COMPLETED"),
  extended: z.boolean(),
});
export type FinishWorkoutResponse = z.infer<typeof finishWorkoutResponse>;

/** `PUT /sets/:id` and `PATCH /sets/:id` response: the set as stored. */
export const loggedSet = z.object({
  id: entityId,
  sessionExerciseId: entityId,
  setNumber,
  reps: repsValue.nullable(),
  weight: weightValue.nullable(),
  weightUnit: weightUnit.nullable(),
  kind: z.enum(["NORMAL", "WARMUP", "DROP"]),
  loggedAt: isoDateTime,
});
export type LoggedSet = z.infer<typeof loggedSet>;
