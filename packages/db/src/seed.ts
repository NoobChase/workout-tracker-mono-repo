// Upserts the standard exercise catalog (spec step 2, decision 8). Idempotent:
// a run with nothing changed in `catalog.ts` writes no row at all, not merely
// the same values -- every upsert is guarded by IS DISTINCT FROM, because a
// bare ON CONFLICT DO UPDATE rewrites unchanged rows (new tuple, WAL, vacuum).
//
// Runs from CI only, after migrations, like a migration. Never by hand
// against dev or production.
import { and, inArray, isNotNull, sql } from "drizzle-orm";
import type { CatalogExercise } from "./catalog";
import { exerciseMetrics, exercises } from "./schema";
import type { Executor } from "./scope";

export interface SeedSummary {
  exercisesInserted: number;
  exercisesUpdated: number;
  metricsInserted: number;
  metricsUpdated: number;
  metricsDeleted: number;
}

/**
 * Applies `entries` to the database. Call inside one transaction -- the CLI
 * does -- so a failure part-way leaves the catalog as it was.
 *
 * Only exercises listed in `entries` are touched. Removing an entry leaves its
 * row alone (retire with `isActive: false`); removing a *metric* from an entry
 * deletes that metric row, scoped to exercises in `entries` so an unlisted
 * exercise keeps its metrics.
 */
export async function seedCatalog(
  db: Executor,
  entries: readonly CatalogExercise[],
): Promise<SeedSummary> {
  if (entries.length === 0) {
    throw new Error("refusing to seed an empty catalog");
  }
  const ids = entries.map((e) => e.id);

  // A catalog id must never land on a user's own exercise. Practically
  // impossible with UUIDv7, and silently skipped by the guarded upsert below
  // if it ever happened -- so it is checked, loudly, instead.
  const hijacked = await db
    .select({ id: exercises.id })
    .from(exercises)
    .where(and(inArray(exercises.id, ids), isNotNull(exercises.ownerUserId)));
  if (hijacked.length > 0) {
    throw new Error(
      `catalog ids belong to user exercises: ${hijacked.map((r) => r.id).join(", ")}`,
    );
  }

  // `xmax = 0` is true for a freshly inserted row and false for an updated
  // one -- Postgres' standard way to tell the two apart in RETURNING.
  const wasInserted = sql<boolean>`(xmax = 0)`;

  const upserted = await db
    .insert(exercises)
    .values(
      entries.map((e) => ({
        id: e.id,
        ownerUserId: null,
        name: e.name,
        primaryMuscles: e.primary,
        secondaryMuscles: e.secondary,
        equipment: e.equipment,
        isActive: e.isActive ?? true,
      })),
    )
    .onConflictDoUpdate({
      target: exercises.id,
      set: {
        name: sql`excluded.name`,
        primaryMuscles: sql`excluded.primary_muscles`,
        secondaryMuscles: sql`excluded.secondary_muscles`,
        equipment: sql`excluded.equipment`,
        isActive: sql`excluded.is_active`,
      },
      setWhere: sql`${exercises.ownerUserId} IS NULL AND
        (${exercises.name}, ${exercises.primaryMuscles}, ${exercises.secondaryMuscles},
         ${exercises.equipment}, ${exercises.isActive})
        IS DISTINCT FROM
        (excluded.name, excluded.primary_muscles, excluded.secondary_muscles,
         excluded.equipment, excluded.is_active)`,
    })
    .returning({ inserted: wasInserted });

  const metricRows = entries.flatMap((e) =>
    e.metrics.map((m) => ({
      exerciseId: e.id,
      metric: m.metric,
      isRequired: m.required,
    })),
  );

  const metricsUpserted = await db
    .insert(exerciseMetrics)
    .values(metricRows)
    .onConflictDoUpdate({
      target: [exerciseMetrics.exerciseId, exerciseMetrics.metric],
      set: { isRequired: sql`excluded.is_required` },
      setWhere: sql`${exerciseMetrics.isRequired} IS DISTINCT FROM excluded.is_required`,
    })
    .returning({ inserted: wasInserted });

  // Metrics the file no longer declares, for exercises the file lists. One
  // statement: the declared (exercise, metric) pairs travel as two array
  // parameters. `sql.param` keeps each a single array -- a bare JS array in a
  // sql template would be spread into a comma-separated list.
  const deleted = await db
    .delete(exerciseMetrics)
    .where(
      and(
        inArray(exerciseMetrics.exerciseId, ids),
        sql`NOT EXISTS (
          SELECT 1 FROM unnest(
            ${sql.param(metricRows.map((m) => m.exerciseId))}::uuid[],
            ${sql.param(metricRows.map((m) => m.metric))}::metric_kind[]
          ) AS declared(exercise_id, metric)
          WHERE declared.exercise_id = ${exerciseMetrics.exerciseId}
            AND declared.metric = ${exerciseMetrics.metric}
        )`,
      ),
    )
    .returning({ exerciseId: exerciseMetrics.exerciseId });

  return {
    exercisesInserted: upserted.filter((r) => r.inserted).length,
    exercisesUpdated: upserted.filter((r) => !r.inserted).length,
    metricsInserted: metricsUpserted.filter((r) => r.inserted).length,
    metricsUpdated: metricsUpserted.filter((r) => !r.inserted).length,
    metricsDeleted: deleted.length,
  };
}
