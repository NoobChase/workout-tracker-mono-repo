// The one error type a service function throws on purpose (design D1). It
// carries a kind, not a status code: `apps/api` maps the kinds to
// 404/400/409/403, and `apps/mcp` will map them to tool errors. The message is
// written for the lifter, because the offline queue shows it verbatim when it
// stops on a rejection (design D7).
import {
  CloneConflictError,
  CrossTenantReferenceError,
  type Db,
  type Tx,
} from "@workout-tracker/db";

export type ServiceErrorKind =
  "not_found" | "invalid" | "conflict" | "forbidden";

export class ServiceError extends Error {
  constructor(
    readonly kind: ServiceErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export const notFound = (message: string) =>
  new ServiceError("not_found", message);
export const invalid = (message: string) =>
  new ServiceError("invalid", message);
export const conflict = (message: string) =>
  new ServiceError("conflict", message);

/**
 * Runs `fn` in one transaction and translates the database's refusals into
 * `ServiceError`s. Deferred uniques (`session_sets` set number,
 * `session_exercises` position) only fire at COMMIT, which is why the
 * translation wraps the whole transaction rather than individual statements.
 * Anything not recognised -- a dropped connection, a serialization failure --
 * is rethrown untouched: it is a server fault the client should retry.
 */
export async function transact<T>(
  db: Db,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  try {
    return await db.transaction(fn);
  } catch (error) {
    throw translate(error);
  }
}

// Which noun a missing reference is, in the lifter's words. A row that is
// another user's reads the same as one that does not exist (scope.ts).
const NOUNS: Record<string, string> = {
  workoutPrograms: "That program doesn't exist.",
  workoutPlans: "That program doesn't exist.",
  workouts: "That workout doesn't exist.",
  plannedExercises: "That exercise isn't in your plan.",
  plannedSets: "That set isn't in your plan.",
  workoutSessions: "That workout session doesn't exist.",
  sessionExercises: "That exercise isn't in this workout session.",
  sessionSets: "That set doesn't exist.",
  exercises: "That exercise doesn't exist.",
};

const UNIQUES: Record<string, string> = {
  session_sets_session_exercise_id_set_number_key:
    "That set number is already logged for this exercise.",
  session_exercises_session_id_position_key:
    "Another exercise already holds that place in this workout.",
  workout_programs_user_id_name_key:
    "You already have a program with that name. Try again.",
  exercises_user_name_key:
    "You already have an exercise with that name. Try again.",
};

function translate(error: unknown): unknown {
  if (error instanceof ServiceError) return error;
  if (error instanceof CrossTenantReferenceError) {
    return notFound(NOUNS[error.table] ?? "That doesn't exist.");
  }
  if (error instanceof CloneConflictError) {
    return conflict("Your program changed while this was saving. Try again.");
  }
  const pg = postgresError(error);
  switch (pg?.code) {
    case "23505": // unique_violation
      return conflict(
        UNIQUES[pg.constraint ?? ""] ??
          "That conflicts with something already saved.",
      );
    case "23503": // foreign_key_violation
      return notFound("Something this refers to no longer exists.");
    case "23514": // check_violation
    case "23502": // not_null_violation
      return invalid("Those values can't be saved.");
    default:
      return error;
  }
}

interface PostgresError {
  code: string;
  constraint?: string;
}

/** The driver's error, found under drizzle's `DrizzleQueryError` wrapper. */
function postgresError(error: unknown): PostgresError | undefined {
  for (let e = error, depth = 0; e && depth < 5; depth++) {
    if (typeof e !== "object") return undefined;
    const { code, constraint, cause } = e as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) {
      return {
        code,
        constraint: typeof constraint === "string" ? constraint : undefined,
      };
    }
    e = cause;
  }
  return undefined;
}
