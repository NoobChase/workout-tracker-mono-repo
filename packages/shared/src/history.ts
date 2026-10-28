import { z } from "zod";
import { entityId, isoDateTime } from "./ids.js";
import { repsValue, setNumber, weightUnit, weightValue } from "./units.js";

/** `GET /history?cursor=`: completed sessions, newest first. */
export const historyPageResponse = z.object({
  items: z.array(
    z.object({
      sessionId: entityId,
      performedAt: isoDateTime,
      programName: z.string(),
      workoutName: z.string(),
      cycleNumber: z.number().int().min(1),
      countedSets: z.number().int().min(0),
    }),
  ),
  nextCursor: z.string().nullable(),
});
export type HistoryPageResponse = z.infer<typeof historyPageResponse>;

/** `GET /sessions/:id`: one session with every set as logged. */
export const sessionDetailResponse = z.object({
  session: z.object({
    id: entityId,
    workoutId: entityId,
    workoutName: z.string(),
    programName: z.string(),
    cycleNumber: z.number().int().min(1),
    performedAt: isoDateTime,
    status: z.enum(["IN_PROGRESS", "COMPLETED", "SKIPPED"]),
  }),
  exercises: z.array(
    z.object({
      position: z.number().int().min(0),
      // The session_exercises row; null when skipped (no row exists). Lets
      // another device continue a session under the same row.
      sessionExerciseId: entityId.nullable(),
      exerciseId: entityId,
      name: z.string(),
      plannedExerciseId: entityId.nullable(),
      skipped: z.boolean(),
      sets: z.array(
        z.object({
          id: entityId,
          setNumber,
          reps: repsValue.nullable(),
          weight: weightValue.nullable(),
          weightUnit: weightUnit.nullable(),
          kind: z.enum(["NORMAL", "WARMUP", "DROP"]),
        }),
      ),
    }),
  ),
});
export type SessionDetailResponse = z.infer<typeof sessionDetailResponse>;
