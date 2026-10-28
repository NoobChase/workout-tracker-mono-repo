// Reviewing finished workouts (specs/workout-history). Reads only, open to
// lapsed accounts (the route mounts no requirePro).
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import {
  countsAsSet,
  exercises,
  plannedExercises,
  sessionExercises,
  sessionSets,
  userScope,
  workoutPlans,
  workoutPrograms,
  workoutSessions,
  workouts,
  type Db,
  type UserId,
} from "@workout-tracker/db";
import type {
  HistoryPageResponse,
  SessionDetailResponse,
} from "@workout-tracker/shared";
import { invalid, notFound } from "./errors";
import { toIso, toNumber } from "./rows";

export const HISTORY_PAGE_SIZE = 20;

export interface HistoryPageInput {
  /** `nextCursor` from the previous page; absent for the first. */
  cursor?: string | null;
}

/**
 * The user's COMPLETED sessions, newest first, a page at a time. Keyset
 * paging on (performed_at DESC, id DESC): a session finished while the lifter
 * scrolls cannot shift a page, so pages never repeat or skip.
 */
export async function getWorkoutHistory(
  db: Db,
  user: UserId,
  input: HistoryPageInput = {},
): Promise<HistoryPageResponse> {
  const scope = userScope(user);
  const after = input.cursor ? decodeCursor(input.cursor) : undefined;

  const rows = await db
    .select({
      sessionId: workoutSessions.id,
      performedAt: workoutSessions.performedAt,
      // Microsecond-exact, unlike a JS Date, so the cursor never rounds a row
      // out of (or back into) the next page.
      key: sql<string>`to_char(${workoutSessions.performedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      programName: workoutPrograms.name,
      workoutName: workouts.name,
      cycleNumber: workoutPlans.cycleNumber,
    })
    .from(workoutSessions)
    .innerJoin(workouts, eq(workouts.id, workoutSessions.workoutId))
    .innerJoin(workoutPlans, eq(workoutPlans.id, workouts.planId))
    .innerJoin(workoutPrograms, eq(workoutPrograms.id, workoutPlans.programId))
    .where(
      and(
        scope.workoutSessions,
        scope.workouts,
        eq(workoutSessions.status, "COMPLETED"),
        after
          ? sql`(${workoutSessions.performedAt}, ${workoutSessions.id}) < (${after.performedAt}::timestamptz, ${after.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(desc(workoutSessions.performedAt), desc(workoutSessions.id))
    .limit(HISTORY_PAGE_SIZE + 1);

  const page = rows.slice(0, HISTORY_PAGE_SIZE);
  const counts =
    page.length === 0
      ? []
      : await db
          .select({ sessionId: sessionExercises.sessionId, n: count() })
          .from(sessionSets)
          .innerJoin(
            sessionExercises,
            eq(sessionExercises.id, sessionSets.sessionExerciseId),
          )
          .where(
            and(
              scope.sessionSets,
              countsAsSet,
              inArray(
                sessionExercises.sessionId,
                page.map((r) => r.sessionId),
              ),
            ),
          )
          .groupBy(sessionExercises.sessionId);
  const counted = new Map(counts.map((c) => [c.sessionId, c.n]));

  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({
      sessionId: r.sessionId,
      performedAt: toIso(r.performedAt),
      programName: r.programName,
      workoutName: r.workoutName,
      cycleNumber: r.cycleNumber,
      countedSets: counted.get(r.sessionId) ?? 0,
    })),
    nextCursor:
      rows.length > HISTORY_PAGE_SIZE && last
        ? encodeCursor({ performedAt: last.key, id: last.sessionId })
        : null,
  };
}

/**
 * One session as logged: each exercise performed, in position order, with its
 * sets in set-number order, and each planned exercise of the workout that has
 * no session exercise marked `skipped` (operations.md 4.7) at its planned
 * position. For an IN_PROGRESS session "skipped" means "not logged yet"; the
 * caller reads `status`. Another user's session is `not_found`, exactly as a
 * missing one.
 */
export async function getSession(
  db: Db,
  user: UserId,
  sessionId: string,
): Promise<SessionDetailResponse> {
  const scope = userScope(user);
  const [session] = await db
    .select({
      id: workoutSessions.id,
      workoutId: workouts.id,
      workoutName: workouts.name,
      programName: workoutPrograms.name,
      cycleNumber: workoutPlans.cycleNumber,
      performedAt: workoutSessions.performedAt,
      status: workoutSessions.status,
    })
    .from(workoutSessions)
    .innerJoin(workouts, eq(workouts.id, workoutSessions.workoutId))
    .innerJoin(workoutPlans, eq(workoutPlans.id, workouts.planId))
    .innerJoin(workoutPrograms, eq(workoutPrograms.id, workoutPlans.programId))
    .where(
      and(
        scope.workoutSessions,
        scope.workouts,
        eq(workoutSessions.id, sessionId),
      ),
    );
  if (!session) throw notFound("That workout session doesn't exist.");

  const performed = await db
    .select({
      id: sessionExercises.id,
      position: sessionExercises.position,
      exerciseId: sessionExercises.exerciseId,
      name: exercises.name,
      plannedExerciseId: sessionExercises.plannedExerciseId,
    })
    .from(sessionExercises)
    .innerJoin(exercises, eq(exercises.id, sessionExercises.exerciseId))
    .where(
      and(scope.sessionExercises, eq(sessionExercises.sessionId, sessionId)),
    )
    .orderBy(sessionExercises.position);

  const sets =
    performed.length === 0
      ? []
      : await db
          .select({
            id: sessionSets.id,
            sessionExerciseId: sessionSets.sessionExerciseId,
            setNumber: sessionSets.setNumber,
            reps: sessionSets.reps,
            weight: sessionSets.weight,
            weightUnit: sessionSets.weightUnit,
            kind: sessionSets.kind,
          })
          .from(sessionSets)
          .where(
            and(
              scope.sessionSets,
              inArray(
                sessionSets.sessionExerciseId,
                performed.map((p) => p.id),
              ),
            ),
          )
          .orderBy(sessionSets.setNumber);

  const planned = await db
    .select({
      id: plannedExercises.id,
      position: plannedExercises.position,
      exerciseId: exercises.id,
      name: exercises.name,
    })
    .from(plannedExercises)
    .innerJoin(exercises, eq(exercises.id, plannedExercises.exerciseId))
    .where(
      and(
        scope.plannedExercises,
        eq(plannedExercises.workoutId, session.workoutId),
      ),
    )
    .orderBy(plannedExercises.position);
  const reached = new Set(performed.map((p) => p.plannedExerciseId));

  const entries = [
    ...performed.map((p) => ({
      position: p.position,
      sessionExerciseId: p.id,
      exerciseId: p.exerciseId,
      name: p.name,
      plannedExerciseId: p.plannedExerciseId,
      skipped: false,
      sets: sets
        .filter((s) => s.sessionExerciseId === p.id)
        .map((s) => ({
          id: s.id,
          setNumber: s.setNumber,
          reps: s.reps,
          weight: toNumber(s.weight),
          weightUnit: s.weightUnit,
          kind: s.kind,
        })),
    })),
    ...planned
      .filter((p) => !reached.has(p.id))
      .map((p) => ({
        position: p.position,
        sessionExerciseId: null,
        exerciseId: p.exerciseId,
        name: p.name,
        plannedExerciseId: p.id,
        skipped: true,
        sets: [],
      })),
  ];
  // Stable: on a tie, what was performed stays ahead of what was skipped.
  entries.sort((a, b) => a.position - b.position);

  return {
    session: { ...session, performedAt: toIso(session.performedAt) },
    exercises: entries,
  };
}

interface Cursor {
  performedAt: string;
  id: string;
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify([c.performedAt, c.id])).toString(
    "base64url",
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

function decodeCursor(raw: string): Cursor {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    );
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string" &&
      STAMP.test(parsed[0]) &&
      UUID.test(parsed[1])
    ) {
      return { performedAt: parsed[0], id: parsed[1] };
    }
  } catch {
    // fall through
  }
  throw invalid("That history page link is no longer valid.");
}
