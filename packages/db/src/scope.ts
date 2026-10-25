// The user-scoping primitives (spec step 2, decision 9). Facts of the schema,
// not a query surface: for each user-owned table, the condition that keeps a
// query inside one user's rows, and the cross-tenant invariants the schema
// deliberately leaves to the application (data-model.md 3.6, "Two constraints
// that are deliberately absent"). Step 3 builds its queries on these; nothing
// writes an inline `WHERE user_id = ...` (root CLAUDE.md).
//
// Every condition is `<column> IN (<subquery up the ownership chain>)`, not a
// correlated EXISTS: it renders the same way in SELECT, UPDATE and DELETE,
// needs no table aliases, and composes with any other condition via `and()`.
import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "./client";
import {
  exercises,
  plannedExercises,
  plannedSets,
  userExerciseSettings,
  workoutPlans,
  workoutPrograms,
  workouts,
} from "./schema";

/**
 * A `users.id`, as resolved from a verified token. Branded so that a program
 * id, an exercise id or a Clerk id cannot be passed where a user is meant --
 * the only producer is `resolveUser`.
 */
export type UserId = string & { readonly __brand: "UserId" };

/** A database handle or an open transaction: scoping must work inside both. */
export type Executor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

// The ownership chain, one level per function, each the ids of that table the
// user owns. Programs carry user_id; everything below reaches it through its
// parent (data-model.md 3.5).
const programIds = (u: UserId) =>
  sql`SELECT ${workoutPrograms.id} FROM ${workoutPrograms} WHERE ${workoutPrograms.userId} = ${u}`;
const planIds = (u: UserId) =>
  sql`SELECT ${workoutPlans.id} FROM ${workoutPlans} WHERE ${workoutPlans.programId} IN (${programIds(u)})`;
const workoutIds = (u: UserId) =>
  sql`SELECT ${workouts.id} FROM ${workouts} WHERE ${workouts.planId} IN (${planIds(u)})`;
const plannedExerciseIds = (u: UserId) =>
  sql`SELECT ${plannedExercises.id} FROM ${plannedExercises} WHERE ${plannedExercises.workoutId} IN (${workoutIds(u)})`;

export interface UserScope {
  readonly userId: UserId;
  readonly workoutPrograms: SQL;
  readonly workoutPlans: SQL;
  readonly workouts: SQL;
  readonly plannedExercises: SQL;
  readonly plannedSets: SQL;
  readonly userExerciseSettings: SQL;
  /** Custom exercises this user created: what they may edit or retire. */
  readonly ownedExercises: SQL;
  /** Standard plus their own: what they may see and reference. */
  readonly visibleExercises: SQL;
}

/**
 * The per-table conditions for one user. Use as the `where`, or `and()` it
 * with the query's own condition:
 *
 *     const scope = userScope(user.id);
 *     db.select().from(plannedSets).where(and(scope.plannedSets, eq(plannedSets.id, id)));
 *
 * A row outside the scope is indistinguishable from a row that does not exist,
 * so a lookup of another user's id finds nothing rather than revealing it.
 */
export function userScope(userId: UserId): UserScope {
  const u = userId;
  return {
    userId: u,
    workoutPrograms: eq(workoutPrograms.userId, u),
    workoutPlans: sql`${workoutPlans.programId} IN (${programIds(u)})`,
    workouts: sql`${workouts.planId} IN (${planIds(u)})`,
    plannedExercises: sql`${plannedExercises.workoutId} IN (${workoutIds(u)})`,
    plannedSets: sql`${plannedSets.plannedExerciseId} IN (${plannedExerciseIds(u)})`,
    userExerciseSettings: eq(userExerciseSettings.userId, u),
    ownedExercises: eq(exercises.ownerUserId, u),
    // `or` of two defined conditions is never undefined.
    visibleExercises: or(
      isNull(exercises.ownerUserId),
      eq(exercises.ownerUserId, u),
    )!,
  };
}

/** A write referenced a row the user may not reference -- or one that does not exist. */
export class CrossTenantReferenceError extends Error {
  constructor(
    readonly table: string,
    readonly ids: readonly string[],
  ) {
    super(`${table}: ${ids.length} id(s) not accessible to this user`);
    this.name = "CrossTenantReferenceError";
  }
}

const ownedTables = {
  workoutPrograms,
  workoutPlans,
  workouts,
  plannedExercises,
  plannedSets,
  userExerciseSettings,
} as const;

export type OwnedTable = keyof typeof ownedTables;

/**
 * The write-side invariant: before inserting a row that points at a parent --
 * a planned exercise into a workout, a session at a workout (step 3) -- prove
 * the parent is the user's. A foreign key only proves it exists. Throws
 * `CrossTenantReferenceError` naming the ids that failed, which is also what
 * an id that does not exist at all gets: the two are deliberately the same.
 *
 * Run it inside the write's transaction (pass the `tx`), so the check and the
 * insert see the same rows.
 */
export async function assertOwned(
  db: Executor,
  userId: UserId,
  table: OwnedTable,
  ids: readonly string[],
): Promise<void> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return;
  const t = ownedTables[table];
  const found = await db
    .select({ id: t.id })
    .from(t)
    .where(and(userScope(userId)[table], inArray(t.id, wanted)));
  rejectMissing(table, wanted, found);
}

/**
 * Exercises a user may reference from their plans, settings or sessions:
 * standard ones and their own, never another user's private exercise
 * (data-model.md 3.6). Retired exercises still pass -- history keeps
 * pointing at them, and whether to offer one in a picker is a UI decision.
 */
export async function assertExercisesUsable(
  db: Executor,
  userId: UserId,
  exerciseIds: readonly string[],
): Promise<void> {
  const wanted = [...new Set(exerciseIds)];
  if (wanted.length === 0) return;
  const found = await db
    .select({ id: exercises.id })
    .from(exercises)
    .where(
      and(userScope(userId).visibleExercises, inArray(exercises.id, wanted)),
    );
  rejectMissing("exercises", wanted, found);
}

function rejectMissing(
  table: string,
  wanted: readonly string[],
  found: readonly { id: string }[],
): void {
  if (found.length === wanted.length) return;
  const present = new Set(found.map((r) => r.id));
  throw new CrossTenantReferenceError(
    table,
    wanted.filter((id) => !present.has(id)),
  );
}
