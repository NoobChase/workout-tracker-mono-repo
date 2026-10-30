// Skipping a whole workout (operations.md 4.14; step-4a design D15;
// specs/workout-sessions "A whole workout can be skipped before it starts"
// and "Skipping the last workout rolls the program over like finishing"),
// against a real Neon branch. Races are forced with an open transaction
// holding a lock, as test/finish.test.ts does.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { UserId } from "@workout-tracker/db";
import { skippedSession, type SkipWorkoutInput } from "@workout-tracker/shared";
import { skipWorkout, whatsNext } from "../src/index";
import {
  Training,
  blockedBy,
  cleanup,
  db,
  newId,
  newUser,
  pool,
  rejectsWith,
  rowCount,
  startTemplate,
  type ProgramFixture,
} from "./db";

after(cleanup);

const NOW = "2026-10-29T12:00:00.000Z";

function skipOf(workoutId: string): SkipWorkoutInput {
  return { sessionId: newId(), workoutId, performedAt: NOW };
}

async function cycleNumbers(programId: string) {
  const { rows } = await pool.query<{ cycle_number: number }>(
    "SELECT cycle_number FROM workout_plans WHERE program_id = $1 ORDER BY cycle_number",
    [programId],
  );
  return rows.map((r) => r.cycle_number);
}

async function programStatus(programId: string) {
  const { rows } = await pool.query<{ status: string }>(
    "SELECT status FROM workout_programs WHERE id = $1",
    [programId],
  );
  return rows[0]!.status;
}

async function sessionsOf(user: UserId) {
  const { rows } = await pool.query<{
    id: string;
    workout_id: string;
    status: string;
  }>(
    "SELECT id, workout_id, status FROM workout_sessions WHERE user_id = $1 ORDER BY id",
    [user],
  );
  return rows;
}

async function finishOne(user: UserId, w: ProgramFixture["workouts"][number]) {
  const t = await Training.start(user, w);
  await t.log(0, 1, 5, 100);
  await t.finish();
}

describe("skipWorkout", () => {
  it("writes one SKIPPED session and nothing else; what's next moves on", async () => {
    const user = await newUser();
    const { programId, workouts } = await startTemplate(user);
    const [push, pull] = workouts;
    const input = skipOf(push!.id);

    const result = skippedSession.parse(await skipWorkout(db, user, input));

    assert.deepEqual(result, {
      id: input.sessionId,
      workoutId: push!.id,
      status: "SKIPPED",
      performedAt: NOW,
    });
    assert.deepEqual(await sessionsOf(user), [
      { id: input.sessionId, workout_id: push!.id, status: "SKIPPED" },
    ]);
    assert.equal(
      await rowCount(
        "SELECT 1 FROM session_exercises se JOIN workout_sessions s ON s.id = se.session_id WHERE s.user_id = $1",
        [user],
      ),
      0,
    );
    assert.deepEqual(await cycleNumbers(programId), [1]);
    const next = await whatsNext(db, user);
    assert.equal(next.next[0]!.workoutId, pull!.id);
    assert.deepEqual(next.inProgress, []);
  });

  it("is idempotent on the session id: same answer, one row, nothing rewritten", async () => {
    const user = await newUser();
    const { workouts } = await startTemplate(user);
    const input = skipOf(workouts[0]!.id);
    const first = await skipWorkout(db, user, input);
    const { rows: x1 } = await pool.query(
      "SELECT xmin::text FROM workout_sessions WHERE id = $1",
      [input.sessionId],
    );

    const again = await skipWorkout(db, user, {
      ...input,
      performedAt: "2026-10-30T08:00:00.000Z",
    });

    assert.deepEqual(again, first);
    assert.equal((await sessionsOf(user)).length, 1);
    const { rows: x2 } = await pool.query(
      "SELECT xmin::text FROM workout_sessions WHERE id = $1",
      [input.sessionId],
    );
    assert.deepEqual(x2, x1);
  });

  it("extends an open-ended program when it skips the cycle's last workout; a replay adds nothing", async () => {
    const user = await newUser();
    const { programId, workouts } = await startTemplate(user);
    await finishOne(user, workouts[0]!);
    await finishOne(user, workouts[1]!);
    const input = skipOf(workouts[2]!.id);

    await skipWorkout(db, user, input);

    assert.deepEqual(await cycleNumbers(programId), [1, 2]);
    assert.equal(await programStatus(programId), "ACTIVE");
    const next = await whatsNext(db, user);
    assert.equal(next.next[0]!.cycleNumber, 2);
    assert.equal(next.next[0]!.workoutName, workouts[0]!.name);

    // Resolve all of cycle 2 behind the services' back, so the program is
    // ACTIVE with nothing unresolved: if the replay re-ran the roll-over (no
    // `inserted.length` gate), it would add cycle 3 here.
    await pool.query(
      `INSERT INTO workout_sessions (id, user_id, workout_id, status)
       SELECT gen_random_uuid(), $1, w.id, 'SKIPPED'
         FROM workouts w JOIN workout_plans p ON p.id = w.plan_id
        WHERE p.program_id = $2 AND p.cycle_number = 2`,
      [user, programId],
    );
    const before = await sessionsOf(user);

    await skipWorkout(db, user, input);
    assert.deepEqual(await cycleNumbers(programId), [1, 2]);
    assert.deepEqual(await sessionsOf(user), before);
  });

  it("completes a fixed program when it skips the last workout, adding no cycle", async () => {
    const user = await newUser();
    const { programId, workouts } = await startTemplate(user);
    await pool.query(
      "UPDATE workout_programs SET target_cycles = 1 WHERE id = $1",
      [programId],
    );
    await skipWorkout(db, user, skipOf(workouts[0]!.id));
    await finishOne(user, workouts[1]!);
    await skipWorkout(db, user, skipOf(workouts[2]!.id));

    assert.equal(await programStatus(programId), "COMPLETED");
    assert.deepEqual(await cycleNumbers(programId), [1]);
    assert.deepEqual((await whatsNext(db, user)).next, []);
  });

  it("refuses a workout that already has a session, naming it, and writes nothing", async () => {
    const user = await newUser();
    const { workouts } = await startTemplate(user);
    const [push, pull, legs] = workouts;
    await Training.start(user, push!);
    await finishOne(user, pull!);
    await skipWorkout(db, user, skipOf(legs!.id));
    const before = await sessionsOf(user);

    const started = await rejectsWith(
      skipWorkout(db, user, skipOf(push!.id)),
      "conflict",
    );
    assert.equal(
      started.message,
      `${push!.name} is already started, so it can't be skipped. Finish it instead.`,
    );
    const done = await rejectsWith(
      skipWorkout(db, user, skipOf(pull!.id)),
      "conflict",
    );
    assert.match(done.message, new RegExp(`^${pull!.name} is already done`));
    await rejectsWith(skipWorkout(db, user, skipOf(legs!.id)), "conflict");

    assert.deepEqual(await sessionsOf(user), before);
  });

  it("refuses a session id already used for another workout or by another user", async () => {
    const user = await newUser();
    const { workouts } = await startTemplate(user);
    const used = await Training.start(user, workouts[0]!);
    const other = await newUser();
    const theirs = await startTemplate(other);

    await rejectsWith(
      skipWorkout(db, user, {
        ...skipOf(workouts[1]!.id),
        sessionId: used.sessionId,
      }),
      "conflict",
    );
    const skipped = skipOf(theirs.workouts[0]!.id);
    await skipWorkout(db, other, skipped);
    await rejectsWith(
      skipWorkout(db, user, {
        ...skipOf(workouts[1]!.id),
        sessionId: skipped.sessionId,
      }),
      "conflict",
    );

    assert.equal((await sessionsOf(user)).length, 1);
    assert.equal(
      await rowCount("SELECT 1 FROM workout_sessions WHERE workout_id = $1", [
        workouts[1]!.id,
      ]),
      0,
    );
  });

  it("is not_found for another user's workout, writing nothing", async () => {
    const owner = await newUser();
    const { workouts } = await startTemplate(owner);
    const intruder = await newUser();

    await rejectsWith(
      skipWorkout(db, intruder, skipOf(workouts[0]!.id)),
      "not_found",
    );
    await rejectsWith(skipWorkout(db, intruder, skipOf(newId())), "not_found");
    assert.equal((await sessionsOf(owner)).length, 0);
    assert.equal((await sessionsOf(intruder)).length, 0);
  });

  it("skips under an ARCHIVED program without extending or completing it", async () => {
    const user = await newUser();
    const { programId, workouts } = await startTemplate(user);
    await finishOne(user, workouts[0]!);
    await finishOne(user, workouts[1]!);
    await pool.query(
      "UPDATE workout_programs SET status = 'ARCHIVED' WHERE id = $1",
      [programId],
    );

    await skipWorkout(db, user, skipOf(workouts[2]!.id));

    assert.equal(await programStatus(programId), "ARCHIVED");
    assert.deepEqual(await cycleNumbers(programId), [1]);
  });

  it("waits out a start in flight on the same workout, then refuses", async () => {
    const user = await newUser();
    const { workouts } = await startTemplate(user);
    const push = workouts[0]!;

    // A start that has inserted its session but not committed holds a
    // key-share lock on the workout; the skip's FOR UPDATE waits for it and
    // then sees the session.
    const holder = await pool.connect();
    let outcome: Promise<unknown>;
    try {
      await holder.query("BEGIN");
      const { rows } = await holder.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );
      await holder.query(
        "INSERT INTO workout_sessions (id, user_id, workout_id, status) VALUES ($1, $2, $3, 'IN_PROGRESS')",
        [newId(), user, push.id],
      );
      outcome = skipWorkout(db, user, skipOf(push.id));
      outcome.catch(() => undefined);
      await blockedBy([rows[0]!.pid]);
      await holder.query("COMMIT");
    } finally {
      holder.release();
    }

    await rejectsWith(outcome, "conflict");
    assert.deepEqual(
      (await sessionsOf(user)).map((s) => s.status),
      ["IN_PROGRESS"],
    );
  });

  it("extends exactly once when a skip and a finish resolve the last two workouts concurrently", async () => {
    const user = await newUser();
    const { programId, workouts } = await startTemplate(user);
    await finishOne(user, workouts[0]!);
    const t = await Training.start(user, workouts[1]!);
    await t.log(0, 1, 5, 100);

    const holder = await pool.connect();
    let results;
    try {
      await holder.query("BEGIN");
      const { rows } = await holder.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );
      const holderPid = rows[0]!.pid;
      await holder.query(
        "SELECT 1 FROM workout_programs WHERE id = $1 FOR UPDATE",
        [programId],
      );

      const finish = t.finish();
      const finishPid = await blockedBy([holderPid]);
      const skip = skipWorkout(db, user, skipOf(workouts[2]!.id));
      await blockedBy([holderPid, finishPid], [finishPid]);
      await holder.query("COMMIT");
      results = await Promise.all([finish, skip]);
    } finally {
      holder.release();
    }

    assert.equal(results[1].status, "SKIPPED");
    assert.deepEqual(await cycleNumbers(programId), [1, 2]);
    assert.equal((await whatsNext(db, user)).next[0]!.cycleNumber, 2);
  });
});
