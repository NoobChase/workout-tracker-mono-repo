// specs/workout-history, against a real Neon branch.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import {
  historyPageResponse,
  sessionDetailResponse,
} from "@workout-tracker/shared";
import { HISTORY_PAGE_SIZE, getSession, getWorkoutHistory } from "../src/index";
import {
  Training,
  cleanup,
  db,
  newId,
  newUser,
  pool,
  rejectsWith,
  startTemplate,
} from "./db";

after(cleanup);

const day = (d: number) => new Date(Date.UTC(2026, 8, d, 17, 30)).toISOString();

describe("getWorkoutHistory", () => {
  it("lists completed sessions newest first, without in-progress ones", async () => {
    const user = await newUser();
    const { workouts } = await startTemplate(user);
    const done = [];
    for (const [i, d] of [3, 5, 7].entries()) {
      const t = await Training.start(user, workouts[i]!, day(d));
      await t.log(0, 1, 5, 100);
      await t.finish();
      done.push(t.sessionId);
    }
    const open = await Training.start(user, workouts[0]!, day(9));
    await open.log(0, 1, 5, 100);

    const page = historyPageResponse.parse(await getWorkoutHistory(db, user));

    assert.deepEqual(
      page.items.map((i) => i.sessionId),
      [...done].reverse(),
    );
    assert.deepEqual(page.items[0], {
      sessionId: done[2],
      performedAt: day(7),
      programName: "Push Pull Legs",
      workoutName: "Legs",
      cycleNumber: 1,
      countedSets: 1,
    });
    assert.equal(page.nextCursor, null);
  });

  it("counts only sets that count: not warm-ups, not drop-set children", async () => {
    const user = await newUser();
    const { workouts } = await startTemplate(user);
    const t = await Training.start(user, workouts[0]!);
    const sets = [];
    for (let n = 1; n <= 7; n++) sets.push(await t.log(0, n, 5, 100));
    // Sets 1-2 become warm-ups; 3-7 stay normal; a drop child hangs off 7.
    await pool.query(
      "UPDATE session_sets SET kind = 'WARMUP' WHERE id = ANY($1::uuid[])",
      [[sets[0]!.id, sets[1]!.id]],
    );
    await pool.query(
      "INSERT INTO session_sets (id, session_exercise_id, set_number, reps, weight, weight_unit, kind, parent_set_id) VALUES ($1, $2, 8, 6, 80, 'LB', 'DROP', $3)",
      [newId(), sets[6]!.sessionExerciseId, sets[6]!.id],
    );
    await t.finish();

    const page = await getWorkoutHistory(db, user);
    assert.equal(page.items[0]!.countedSets, 5);
  });

  it("never shows another user's sessions", async () => {
    const other = await newUser();
    const o = await startTemplate(other);
    const t = await Training.start(other, o.workouts[0]!);
    await t.log(0, 1, 5, 100);
    await t.finish();

    const user = await newUser();
    await startTemplate(user);
    assert.deepEqual(await getWorkoutHistory(db, user), {
      items: [],
      nextCursor: null,
    });
  });

  it("pages through a long record with no repeats and no gaps", async () => {
    const user = await newUser();
    const { workouts } = await startTemplate(user);
    // Inserted directly: 2 * page + 5 sessions, some sharing a timestamp so
    // the id tiebreak is exercised.
    const total = HISTORY_PAGE_SIZE * 2 + 5;
    const ids: string[] = [];
    for (let i = 0; i < total; i++) {
      const id = newId();
      ids.push(id);
      await pool.query(
        `INSERT INTO workout_sessions (id, user_id, workout_id, status, performed_at)
         VALUES ($1, $2, $3, 'COMPLETED', $4)`,
        [id, user, workouts[i % 3]!.id, day(1 + Math.floor(i / 2))],
      );
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = historyPageResponse.parse(
        await getWorkoutHistory(db, user, { cursor }),
      );
      assert.ok(page.items.length <= HISTORY_PAGE_SIZE);
      seen.push(...page.items.map((i) => i.sessionId));
      cursor = page.nextCursor;
      pages++;
    } while (cursor);

    assert.equal(pages, 3);
    assert.equal(new Set(seen).size, total, "no repeats");
    // Newest first; ties broken by id descending.
    const expected = ids
      .map((id, i) => ({ id, at: day(1 + Math.floor(i / 2)) }))
      .sort((a, b) =>
        a.at === b.at ? (a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1,
      )
      .map((x) => x.id);
    assert.deepEqual(seen, expected, "no gaps, in order");
  });

  it("refuses a malformed cursor", async () => {
    const user = await newUser();
    await rejectsWith(
      getWorkoutHistory(db, user, { cursor: "not-a-cursor" }),
      "invalid",
    );
  });
});

describe("getSession", () => {
  it("shows each exercise in order with its sets and units, and skipped ones as skipped", async () => {
    const user = await newUser();
    const { workouts } = await startTemplate(user);
    const legs = workouts[2]!; // Back Squat first, then four more
    const t = await Training.start(user, legs, day(12));
    const squat = [];
    for (let n = 1; n <= 3; n++) squat.push(await t.log(0, n, 5, 225 + n));
    await t.log(1, 1, 8, 135, "KG");
    await t.finish();

    const detail = sessionDetailResponse.parse(
      await getSession(db, user, t.sessionId),
    );

    assert.deepEqual(detail.session, {
      id: t.sessionId,
      workoutId: legs.id,
      workoutName: "Legs",
      programName: "Push Pull Legs",
      cycleNumber: 1,
      performedAt: day(12),
      status: "COMPLETED",
    });
    assert.deepEqual(
      detail.exercises.map((e) => [e.plannedExerciseId, e.skipped]),
      legs.exercises.map((pe, i) => [pe.id, i > 1]),
    );
    assert.deepEqual(detail.exercises[0]!.sets, [
      {
        id: squat[0]!.id,
        setNumber: 1,
        reps: 5,
        weight: 226,
        weightUnit: "LB",
        kind: "NORMAL",
      },
      {
        id: squat[1]!.id,
        setNumber: 2,
        reps: 5,
        weight: 227,
        weightUnit: "LB",
        kind: "NORMAL",
      },
      {
        id: squat[2]!.id,
        setNumber: 3,
        reps: 5,
        weight: 228,
        weightUnit: "LB",
        kind: "NORMAL",
      },
    ]);
    assert.equal(detail.exercises[1]!.sets[0]!.weightUnit, "KG");
    for (const skipped of detail.exercises.slice(2)) {
      assert.deepEqual(skipped.sets, []);
      assert.ok(skipped.name.length > 0);
    }
  });

  it("answers another user's session exactly as a missing one", async () => {
    const other = await newUser();
    const o = await startTemplate(other);
    const t = await Training.start(other, o.workouts[0]!);
    await t.finish();

    const user = await newUser();
    const foreign = await rejectsWith(
      getSession(db, user, t.sessionId),
      "not_found",
    );
    const missing = await rejectsWith(
      getSession(db, user, newId()),
      "not_found",
    );
    assert.equal(foreign.message, missing.message);
  });
});
