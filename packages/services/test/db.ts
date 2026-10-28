// Test plumbing. The services open and commit their own transactions, so these
// tests commit for real (a rolled-back outer transaction would be committed by
// the service's own COMMIT). Every user is created here with a `seed_` clerk
// id and removed by `cleanup()`.
import { randomUUID } from "node:crypto";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { createDb, type UserId } from "@workout-tracker/db";
import { newId, type LogSetRequest } from "@workout-tracker/shared";
import {
  finishWorkout,
  logSet,
  startProgramFromTemplate,
  startWorkout,
  type LoggedSet,
  type ServiceError,
  type ServiceErrorKind,
} from "../src/index";

neonConfig.webSocketConstructor = ws;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Run tests through `npm test`, which creates a Neon branch for the run.",
  );
}

export const pool = new Pool({ connectionString });
export const db = createDb(pool);

const userIds: string[] = [];

export async function newUser(
  defaultWeightUnit: "LB" | "KG" = "LB",
): Promise<UserId> {
  const id = newId();
  userIds.push(id);
  await pool.query(
    "INSERT INTO users (id, clerk_user_id, default_weight_unit) VALUES ($1, $2, $3)",
    [id, `seed_services_${randomUUID()}`, defaultWeightUnit],
  );
  return id as UserId;
}

/** Sessions first: they RESTRICT the workouts a program cascade would remove. */
export async function cleanup(): Promise<void> {
  await pool.query(
    "DELETE FROM workout_sessions WHERE user_id = ANY($1::uuid[])",
    [userIds],
  );
  await pool.query(
    "DELETE FROM workout_programs WHERE user_id = ANY($1::uuid[])",
    [userIds],
  );
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]);
  await pool.end();
}

export { newId };

/** Rejects unless `promise` fails with a `ServiceError` of `kind`. */
export async function rejectsWith(
  promise: Promise<unknown>,
  kind: ServiceErrorKind,
): Promise<ServiceError> {
  try {
    await promise;
  } catch (error) {
    const e = error as ServiceError;
    if (e?.name === "ServiceError" && e.kind === kind) return e;
    throw new Error(`expected ServiceError(${kind}), got ${String(error)}`, {
      cause: error,
    });
  }
  throw new Error(`expected ServiceError(${kind}), but it resolved`);
}

export async function rowCount(
  query: string,
  params: unknown[],
): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM (${query}) q`,
    params,
  );
  return rows[0]!.n;
}

export interface ProgramFixture {
  programId: string;
  /** Cycle 1's workouts in position order, each with its planned exercises. */
  workouts: {
    id: string;
    name: string;
    exercises: { id: string; exerciseId: string; targetSets: number }[];
  }[];
}

/** Starts a template for `user` and reads back cycle 1's ids. */
export async function startTemplate(
  user: UserId,
  slug = "push-pull-legs",
): Promise<ProgramFixture> {
  const programId = newId();
  await startProgramFromTemplate(db, user, { programId, templateSlug: slug });
  const { rows } = await pool.query<{
    workout_id: string;
    workout_name: string;
    pe_id: string;
    exercise_id: string;
    target_sets: number;
  }>(
    `SELECT w.id AS workout_id, w.name AS workout_name, pe.id AS pe_id,
            pe.exercise_id, pe.target_sets
       FROM workout_plans p
       JOIN workouts w ON w.plan_id = p.id
       JOIN planned_exercises pe ON pe.workout_id = w.id
      WHERE p.program_id = $1 AND p.cycle_number = 1
      ORDER BY w.position, pe.position`,
    [programId],
  );
  const workouts: ProgramFixture["workouts"] = [];
  for (const r of rows) {
    let w = workouts.find((x) => x.id === r.workout_id);
    if (!w) {
      w = { id: r.workout_id, name: r.workout_name, exercises: [] };
      workouts.push(w);
    }
    w.exercises.push({
      id: r.pe_id,
      exerciseId: r.exercise_id,
      targetSets: r.target_sets,
    });
  }
  return { programId, workouts };
}

/**
 * A session being trained, as the client would drive it: one session
 * exercise id per planned exercise, minted on first contact and reused.
 */
export class Training {
  readonly sessionExerciseIds = new Map<string, string>();
  constructor(
    readonly user: UserId,
    readonly sessionId: string,
    readonly fixture: ProgramFixture["workouts"][number],
  ) {}

  static async start(
    user: UserId,
    workout: ProgramFixture["workouts"][number],
    performedAt = new Date().toISOString(),
  ): Promise<Training> {
    const t = new Training(user, newId(), workout);
    await startWorkout(db, user, t.sessionId, {
      workoutId: workout.id,
      performedAt,
    });
    return t;
  }

  /** The `logSet` request for set `setNumber` of planned exercise `index`. */
  request(
    index: number,
    setNumber: number,
    reps: number,
    weight: number,
    /** `null` sends no unit, leaving it to the server's fallback. */
    weightUnit: "LB" | "KG" | null = "LB",
  ): LogSetRequest {
    const pe = this.fixture.exercises[index]!;
    let seId = this.sessionExerciseIds.get(pe.id);
    if (!seId) {
      seId = newId();
      this.sessionExerciseIds.set(pe.id, seId);
    }
    return {
      sessionExercise: {
        id: seId,
        sessionId: this.sessionId,
        exerciseId: pe.exerciseId,
        plannedExerciseId: pe.id,
        position: index,
      },
      setNumber,
      reps,
      weight,
      ...(weightUnit ? { weightUnit } : {}),
      loggedAt: new Date().toISOString(),
    };
  }

  async log(
    index: number,
    setNumber: number,
    reps: number,
    weight: number,
    weightUnit: "LB" | "KG" | null = "LB",
  ): Promise<LoggedSet & { request: LogSetRequest }> {
    const request = this.request(index, setNumber, reps, weight, weightUnit);
    const set = await logSet(db, this.user, newId(), request);
    return { ...set, request };
  }

  finish() {
    return finishWorkout(db, this.user, this.sessionId);
  }
}
