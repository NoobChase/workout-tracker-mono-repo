// Finishing a workout (operations.md 4.13; design D4): the guarded status
// change, the exhaustion check, and open-ended extension through clonePlan
// (3.12). The races are forced with an open transaction holding a lock, as
// packages/db/test/users.test.ts does -- Promise.all alone does not interleave.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { finishWorkoutResponse } from "@workout-tracker/shared";
import { finishWorkout, whatsNext } from "../src/index";
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
import type { UserId } from "@workout-tracker/db";

after(cleanup);

async function cycles(programId: string) {
  const { rows } = await pool.query<{ cycle_number: number; name: string }>(
    "SELECT cycle_number, name FROM workout_plans WHERE program_id = $1 ORDER BY cycle_number",
    [programId],
  );
  return rows;
}

/** A cycle's shape: workouts, exercises, set targets and rep ranges, in order. */
async function shape(programId: string, cycle: number) {
  const { rows } = await pool.query<{
    name: string;
    position: number;
    exercise_id: string;
    pe_position: number;
    target_sets: number;
    set_number: number;
    target_reps_min: number;
    target_reps_max: number;
  }>(
    `SELECT w.name, w.position, pe.exercise_id, pe.position AS pe_position,
            pe.target_sets, ps.set_number, ps.target_reps_min, ps.target_reps_max
       FROM workout_plans p
       JOIN workouts w ON w.plan_id = p.id
       JOIN planned_exercises pe ON pe.workout_id = w.id
       JOIN planned_sets ps ON ps.planned_exercise_id = pe.id
      WHERE p.program_id = $1 AND p.cycle_number = $2
      ORDER BY w.position, pe.position, ps.set_number`,
    [programId, cycle],
  );
  return rows;
}

async function train(
  user: UserId,
  workout: ProgramFixture["workouts"][number],
) {
  const t = await Training.start(user, workout);
  await t.log(0, 1, 5, 100);
  return t;
}

describe("finishWorkout", () => {
  it("completes a mid-cycle session without adding a cycle", async () => {
    const user = await newUser();
    const { programId, workouts } = await startTemplate(user);
    const t = await train(user, workouts[0]!);

    const result = finishWorkoutResponse.parse(await t.finish());

    assert.deepEqual(result, {
      sessionId: t.sessionId,
      status: "COMPLETED",
      extended: false,
    });
    const { rows } = await pool.query<{ status: string }>(
      "SELECT status FROM workout_sessions WHERE id = $1",
      [t.sessionId],
    );
    assert.equal(rows[0]!.status, "COMPLETED");
    assert.equal((await cycles(programId)).length, 1);
  });

  it("extends an open-ended program by one identical cycle on its last workout", async () => {
    const user = await newUser();
    const { programId, workouts } = await startTemplate(user);
    await pool.query(
      "UPDATE workout_plans SET name = 'Base', notes = 'n' WHERE program_id = $1",
      [programId],
    );
    await (await train(user, workouts[0]!)).finish();
    await (await train(user, workouts[1]!)).finish();
    const last = await (await train(user, workouts[2]!)).finish();

    assert.equal(last.extended, true);
    assert.deepEqual(await cycles(programId), [
      { cycle_number: 1, name: "Base" },
      { cycle_number: 2, name: "Base" },
    ]);
    assert.deepEqual(await shape(programId, 2), await shape(programId, 1));
    const { rows } = await pool.query(
      "SELECT status, target_cycles FROM workout_programs WHERE id = $1",
      [programId],
    );
    assert.deepEqual(rows[0], { status: "ACTIVE", target_cycles: null });

    const next = await whatsNext(db, user);
    assert.equal(next.next[0]!.cycleNumber, 2);
    assert.equal(next.next[0]!.workoutName, "Push");
    assert.notEqual(next.next[0]!.workoutId, workouts[0]!.id);
  });

  it("clones the highest cycle, so edits along the way carry forward", async () => {
    const user = await newUser();
    const { programId, workouts } = await startTemplate(user);
    for (const w of workouts) await (await train(user, w)).finish();
    // Edit cycle 2 before training it.
    await pool.query(
      `UPDATE planned_exercises pe SET target_sets = 4
         FROM workouts w, workout_plans p
        WHERE pe.workout_id = w.id AND w.plan_id = p.id
          AND p.program_id = $1 AND p.cycle_number = 2 AND pe.position = 0`,
      [programId],
    );
    const next = await whatsNext(db, user);
    const { rows: cycle2 } = await pool.query<{
      id: string;
      name: string;
    }>(
      `SELECT w.id, w.name FROM workouts w JOIN workout_plans p ON p.id = w.plan_id
        WHERE p.program_id = $1 AND p.cycle_number = 2 ORDER BY w.position`,
      [programId],
    );
    assert.equal(next.next[0]!.workoutId, cycle2[0]!.id);
    for (const w of cycle2) {
      const t = await Training.start(user, {
        id: w.id,
        name: w.name,
        exercises: [],
      });
      await t.finish();
    }
    const targets = async (cycle: number) =>
      (await shape(programId, cycle))
        .filter((r) => r.pe_position === 0 && r.set_number === 1)
        .map((r) => r.target_sets);
    assert.deepEqual(await targets(3), await targets(2));
    assert.deepEqual(await targets(3), [4, 4, 4]);
  });

  it("treats a SKIPPED last workout as resolved and still extends", async () => {
    const user = await newUser();
    const { programId, workouts } = await startTemplate(user);
    await pool.query(
      "INSERT INTO workout_sessions (id, user_id, workout_id, status) VALUES ($1, $2, $3, 'SKIPPED')",
      [newId(), user, workouts[2]!.id],
    );
    await (await train(user, workouts[0]!)).finish();
    const last = await (await train(user, workouts[1]!)).finish();
    assert.equal(last.extended, true);
    assert.equal((await cycles(programId)).length, 2);
  });

  it("completes a fixed-length program on its last workout instead of extending", async () => {
    const user = await newUser();
    const { programId, workouts } = await startTemplate(user);
    await pool.query(
      "UPDATE workout_programs SET target_cycles = 1 WHERE id = $1",
      [programId],
    );
    for (const w of workouts) {
      assert.equal((await (await train(user, w)).finish()).extended, false);
    }
    const { rows } = await pool.query<{ status: string }>(
      "SELECT status FROM workout_programs WHERE id = $1",
      [programId],
    );
    assert.equal(rows[0]!.status, "COMPLETED");
    assert.equal((await cycles(programId)).length, 1);
  });

  it("completes the session but neither extends nor completes an ARCHIVED program", async () => {
    for (const targetCycles of [null, 1]) {
      const user = await newUser();
      const { programId, workouts } = await startTemplate(user);
      await pool.query(
        "UPDATE workout_programs SET target_cycles = $2 WHERE id = $1",
        [programId, targetCycles],
      );
      await (await train(user, workouts[0]!)).finish();
      await (await train(user, workouts[1]!)).finish();
      // Started (say, offline from a cached workout) before the archive landed.
      const t = await train(user, workouts[2]!);
      await pool.query(
        "UPDATE workout_programs SET status = 'ARCHIVED' WHERE id = $1",
        [programId],
      );

      const result = await t.finish();

      assert.deepEqual(result, {
        sessionId: t.sessionId,
        status: "COMPLETED",
        extended: false,
      });
      const { rows } = await pool.query<{ status: string }>(
        "SELECT status FROM workout_sessions WHERE id = $1",
        [t.sessionId],
      );
      assert.equal(rows[0]!.status, "COMPLETED");
      const { rows: program } = await pool.query<{ status: string }>(
        "SELECT status FROM workout_programs WHERE id = $1",
        [programId],
      );
      assert.equal(program[0]!.status, "ARCHIVED", `target ${targetCycles}`);
      assert.equal((await cycles(programId)).length, 1);
    }
  });

  it("replays as a no-op: one new cycle, nothing rewritten", async () => {
    const user = await newUser();
    const { programId, workouts } = await startTemplate(user);
    await (await train(user, workouts[0]!)).finish();
    await (await train(user, workouts[1]!)).finish();
    const t = await train(user, workouts[2]!);
    assert.equal((await t.finish()).extended, true);
    const { rows: x1 } = await pool.query(
      "SELECT xmin::text FROM workout_sessions WHERE id = $1",
      [t.sessionId],
    );

    const replay = await t.finish();

    assert.deepEqual(replay, {
      sessionId: t.sessionId,
      status: "COMPLETED",
      extended: false,
    });
    assert.equal((await cycles(programId)).length, 2);
    const { rows: x2 } = await pool.query(
      "SELECT xmin::text FROM workout_sessions WHERE id = $1",
      [t.sessionId],
    );
    assert.deepEqual(x2, x1);
  });

  it("adds exactly one cycle when two deliveries of the same finish interleave", async () => {
    const user = await newUser();
    const { programId, workouts } = await startTemplate(user);
    await (await train(user, workouts[0]!)).finish();
    await (await train(user, workouts[1]!)).finish();
    const t = await train(user, workouts[2]!);

    // Hold the program row. The first delivery completes the session (taking
    // its row lock) and then blocks here; the second blocks on the session
    // row behind it. Releasing lets the first extend and commit; the second
    // then finds the session COMPLETED and changes nothing.
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

      const first = t.finish();
      const firstPid = await blockedBy([holderPid]);
      const second = t.finish();
      await blockedBy([firstPid]);
      await holder.query("COMMIT");
      results = await Promise.all([first, second]);
    } finally {
      holder.release();
    }

    assert.deepEqual(
      results.map((r) => r.extended),
      [true, false],
    );
    assert.deepEqual(
      (await cycles(programId)).map((c) => c.cycle_number),
      [1, 2],
    );
  });

  it("extends exactly once when the last two workouts finish concurrently", async () => {
    const user = await newUser();
    const { programId, workouts } = await startTemplate(user);
    await (await train(user, workouts[0]!)).finish();
    const a = await train(user, workouts[1]!);
    const b = await train(user, workouts[2]!);

    // Both sessions are marked COMPLETED before either runs its exhaustion
    // check. Without the program-row lock each would miss the other's
    // uncommitted finish and neither would extend.
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

      const first = a.finish();
      const firstPid = await blockedBy([holderPid]);
      const second = b.finish();
      await blockedBy([holderPid, firstPid], [firstPid]);
      await holder.query("COMMIT");
      results = await Promise.all([first, second]);
    } finally {
      holder.release();
    }

    assert.equal(results.filter((r) => r.extended).length, 1);
    assert.deepEqual(
      (await cycles(programId)).map((c) => c.cycle_number),
      [1, 2],
    );
    assert.equal((await whatsNext(db, user)).next[0]!.cycleNumber, 2);
  });

  it("is not_found for another user's session and changes nothing", async () => {
    const owner = await newUser();
    const { workouts } = await startTemplate(owner);
    const t = await train(owner, workouts[0]!);
    const intruder = await newUser();

    await rejectsWith(finishWorkout(db, intruder, t.sessionId), "not_found");
    await rejectsWith(finishWorkout(db, intruder, newId()), "not_found");
    assert.equal(
      await rowCount(
        "SELECT 1 FROM workout_sessions WHERE id = $1 AND status = 'IN_PROGRESS'",
        [t.sessionId],
      ),
      1,
    );
  });
});
