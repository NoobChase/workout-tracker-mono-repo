// Identity resolution and the user.deleted soft delete (operations.md 1.1,
// 1.4; spec step 2, decision 3). These commit for real rather than using
// inRolledBackTransaction: the concurrency case needs separate connections to
// see each other's rows. Each test uses its own `seed_` clerk id (data-model.md
// 3.2's fixture prefix) and the rows are deleted afterwards.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { createDb, isPro, resolveUser, softDeleteUser } from "../src/index";
import type { SubStatus } from "../src/index";
import { pool } from "./db";

const db = createDb(pool);
const clerkIds: string[] = [];

function freshClerkId(): string {
  const id = `seed_test_${randomUUID()}`;
  clerkIds.push(id);
  return id;
}

after(async () => {
  await pool.query("DELETE FROM users WHERE clerk_user_id = ANY($1)", [
    clerkIds,
  ]);
  await pool.end();
});

async function rowsFor(clerkUserId: string) {
  const { rows } = await pool.query<{
    id: string;
    xmin: string;
    deleted_at: Date | null;
  }>("SELECT id, xmin::text, deleted_at FROM users WHERE clerk_user_id = $1", [
    clerkUserId,
  ]);
  return rows;
}

/** Resolves once some backend is blocked inserting into `users`. */
async function waitForLockWait(): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const { rows } = await pool.query<{ waiting: number }>(
      `SELECT count(*)::int AS waiting FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND query ILIKE 'insert into "users"%'`,
    );
    if (rows[0]!.waiting > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("resolveUser never blocked on the winner's insert");
}

describe("resolveUser", () => {
  it("creates the row on first sight, with the column defaults", async () => {
    const clerkId = freshClerkId();
    const user = await resolveUser(db, clerkId);

    assert.equal(user.subStatus, "NONE");
    assert.equal(user.deletedAt, null);
    // UUIDv7 minted in application code: version nibble 7.
    assert.match(user.id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);

    const rows = await rowsFor(clerkId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.id, user.id);
  });

  it("writes nothing when the row already exists", async () => {
    const clerkId = freshClerkId();
    const first = await resolveUser(db, clerkId);
    const [before] = await rowsFor(clerkId);

    const second = await resolveUser(db, clerkId);
    const [afterwards] = await rowsFor(clerkId);

    assert.equal(second.id, first.id);
    // xmin changes on any UPDATE, including the no-op DO UPDATE that running
    // the upsert unconditionally would perform. Unchanged = select-first held.
    assert.equal(afterwards!.xmin, before!.xmin);
  });

  it("produces exactly one row when a concurrent first request wins the insert", async () => {
    // The race, forced rather than hoped for. Firing N calls at once does not
    // reproduce it: each opens its own WebSocket connection, setup dwarfs the
    // queries, and the first caller has committed before the rest select. So:
    // the "winner" inserts inside an open transaction; resolveUser's select
    // cannot see that row, its insert blocks on the unique index, and only
    // then does the winner commit -- sending it down the ON CONFLICT path.
    const clerkId = freshClerkId();
    const winnerId = "01900000-0000-7000-8000-0000000000aa";
    const winner = await pool.connect();
    try {
      await winner.query("BEGIN");
      await winner.query(
        "INSERT INTO users (id, clerk_user_id) VALUES ($1, $2)",
        [winnerId, clerkId],
      );

      const loser = resolveUser(db, clerkId);
      await waitForLockWait();
      await winner.query("COMMIT");

      assert.equal((await loser).id, winnerId);
    } finally {
      winner.release();
    }
    assert.equal((await rowsFor(clerkId)).length, 1);
  });

  it("returns a soft-deleted user with deletedAt set, for the caller to refuse", async () => {
    const clerkId = freshClerkId();
    await resolveUser(db, clerkId);
    await softDeleteUser(db, clerkId);

    const user = await resolveUser(db, clerkId);
    assert.ok(user.deletedAt instanceof Date);
    assert.equal((await rowsFor(clerkId)).length, 1, "no replacement row");
  });

  it("reads sub_status fresh on every call", async () => {
    const clerkId = freshClerkId();
    await resolveUser(db, clerkId);
    await pool.query(
      "UPDATE users SET sub_status = 'ACTIVE' WHERE clerk_user_id = $1",
      [clerkId],
    );
    assert.equal((await resolveUser(db, clerkId)).subStatus, "ACTIVE");
  });
});

describe("softDeleteUser", () => {
  it("stamps deleted_at once and keeps the first timestamp on redelivery", async () => {
    const clerkId = freshClerkId();
    await resolveUser(db, clerkId);

    assert.equal(await softDeleteUser(db, clerkId), true);
    const [first] = await rowsFor(clerkId);
    assert.ok(first!.deleted_at instanceof Date);

    assert.equal(await softDeleteUser(db, clerkId), false);
    const [second] = await rowsFor(clerkId);
    assert.equal(second!.deleted_at!.getTime(), first!.deleted_at.getTime());
    assert.equal(second!.xmin, first!.xmin, "a redelivery writes nothing");
  });

  it("is a no-op for a user who never made a request", async () => {
    const clerkId = freshClerkId();
    assert.equal(await softDeleteUser(db, clerkId), false);
    assert.equal((await rowsFor(clerkId)).length, 0);
  });
});

describe("isPro", () => {
  const cases: [SubStatus, boolean][] = [
    ["NONE", false],
    ["TRIALING", true],
    ["ACTIVE", true],
    // Pinned: a failed card does not entitle (data-model.md 3.8).
    ["PAST_DUE", false],
    ["CANCELED", false],
  ];
  for (const [status, expected] of cases) {
    it(`${status} -> ${expected}`, () => {
      assert.equal(isPro(status), expected);
    });
  }
});
