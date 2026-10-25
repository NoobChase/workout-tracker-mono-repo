// The catalog seed against a real database (spec step 2, decision 8 and its
// Verification list): a second run is a no-op, edits apply, and a metric
// removed from the file removes its row -- for listed exercises only.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { PoolClient } from "@neondatabase/serverless";
import {
  catalog,
  createDb,
  seedCatalog,
  type CatalogExercise,
  type Db,
} from "../src/index";
import { inRolledBackTransaction, pool } from "./db";

after(() => pool.end());

function inTransaction(fn: (db: Db, client: PoolClient) => Promise<void>) {
  return inRolledBackTransaction((client) => fn(createDb(client), client));
}

/** Every row the catalog owns, with xmin: unchanged xmin = not rewritten. */
async function snapshot(client: PoolClient, ids: string[]) {
  const { rows } = await client.query<{ key: string; xmin: string }>(
    `SELECT 'e:' || id AS key, xmin::text FROM exercises WHERE id = ANY($1)
     UNION ALL
     SELECT 'm:' || exercise_id || ':' || metric, xmin::text
       FROM exercise_metrics WHERE exercise_id = ANY($1)
     ORDER BY key`,
    [ids],
  );
  return rows;
}

const NO_CHANGES = {
  exercisesInserted: 0,
  exercisesUpdated: 0,
  metricsInserted: 0,
  metricsUpdated: 0,
  metricsDeleted: 0,
};

describe("seedCatalog with the real catalog", () => {
  it("creates every entry, and a second run writes nothing", async () => {
    await inTransaction(async (db, client) => {
      const ids = catalog.map((e) => e.id);
      await seedCatalog(db, catalog);

      const { rows } = await client.query<{ n: number; metrics: number }>(
        `SELECT count(*)::int AS n,
                (SELECT count(*)::int FROM exercise_metrics WHERE exercise_id = ANY($1)) AS metrics
           FROM exercises WHERE id = ANY($1) AND owner_user_id IS NULL`,
        [ids],
      );
      assert.equal(rows[0]!.n, catalog.length);
      assert.equal(
        rows[0]!.metrics,
        catalog.reduce((sum, e) => sum + e.metrics.length, 0),
      );

      const before = await snapshot(client, ids);
      assert.deepEqual(await seedCatalog(db, catalog), NO_CHANGES);
      assert.deepEqual(await snapshot(client, ids), before);
    });
  });
});

describe("seedCatalog applying edits", () => {
  const A = "01900000-0000-7000-8000-00000000f001";
  const B = "01900000-0000-7000-8000-00000000f002";
  const UNLISTED = "01900000-0000-7000-8000-00000000f003";

  const v1: CatalogExercise[] = [
    {
      id: A,
      name: "Seed Test Press",
      primary: ["CHEST"],
      secondary: ["TRICEPS"],
      equipment: "BARBELL",
      metrics: [
        { metric: "REPS", required: true },
        { metric: "WEIGHT", required: true },
        { metric: "RPE", required: false },
      ],
    },
    {
      id: B,
      name: "Seed Test Hold",
      primary: ["ABS"],
      secondary: [],
      equipment: "BODYWEIGHT",
      metrics: [{ metric: "DURATION", required: true }],
    },
  ];

  const v2: CatalogExercise[] = [
    {
      ...v1[0]!,
      name: "Seed Test Bench Press", // renamed
      secondary: ["TRICEPS", "FRONT_DELTS"], // muscle added
      isActive: false, // retired
      metrics: [
        { metric: "REPS", required: true },
        { metric: "WEIGHT", required: false }, // flipped
        // RPE removed
      ],
    },
    {
      ...v1[1]!,
      metrics: [
        { metric: "DURATION", required: true },
        { metric: "WEIGHT", required: false }, // added
      ],
    },
  ];

  it("inserts, then applies exactly the edits, leaving unlisted exercises alone", async () => {
    await inTransaction(async (db, client) => {
      // A standard exercise this file does not list, with a metric of its own.
      await client.query(
        "INSERT INTO exercises (id, name) VALUES ($1, 'Seed Test Unlisted')",
        [UNLISTED],
      );
      await client.query(
        "INSERT INTO exercise_metrics (exercise_id, metric) VALUES ($1, 'RPE')",
        [UNLISTED],
      );

      assert.deepEqual(await seedCatalog(db, v1), {
        ...NO_CHANGES,
        exercisesInserted: 2,
        metricsInserted: 4,
      });

      assert.deepEqual(await seedCatalog(db, v2), {
        exercisesInserted: 0,
        exercisesUpdated: 1, // A changed; B's exercise row did not
        metricsInserted: 1, // B gained WEIGHT
        metricsUpdated: 1, // A's WEIGHT flipped
        metricsDeleted: 1, // A's RPE
      });

      const { rows: a } = await client.query(
        "SELECT name, secondary_muscles::text, is_active FROM exercises WHERE id = $1",
        [A],
      );
      assert.deepEqual(a[0], {
        name: "Seed Test Bench Press",
        secondary_muscles: "{TRICEPS,FRONT_DELTS}",
        is_active: false,
      });

      const { rows: metrics } = await client.query<{
        exercise_id: string;
        metric: string;
        is_required: boolean;
      }>(
        `SELECT exercise_id, metric::text, is_required FROM exercise_metrics
          WHERE exercise_id = ANY($1) ORDER BY exercise_id, metric::text`,
        [[A, B, UNLISTED]],
      );
      assert.deepEqual(
        metrics.map(
          (m) => `${m.exercise_id.slice(-1)}:${m.metric}:${m.is_required}`,
        ),
        [
          "1:REPS:true",
          "1:WEIGHT:false",
          "2:DURATION:true",
          "2:WEIGHT:false",
          "3:RPE:true",
        ],
      );
    });
  });

  it("refuses a catalog id that belongs to a user's own exercise", async () => {
    await inTransaction(async (db, client) => {
      const user = "01900000-0000-7000-8000-00000000f0aa";
      await client.query(
        "INSERT INTO users (id, clerk_user_id) VALUES ($1, 'seed_catalog_test')",
        [user],
      );
      await client.query(
        "INSERT INTO exercises (id, owner_user_id, name) VALUES ($1, $2, 'Mine')",
        [A, user],
      );
      await assert.rejects(seedCatalog(db, v1), /belong to user exercises/);
    });
  });

  it("refuses an empty catalog", async () => {
    await inTransaction(async (db) => {
      await assert.rejects(seedCatalog(db, []), /empty catalog/);
    });
  });
});
