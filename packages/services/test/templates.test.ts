// specs/program-templates, against a real Neon branch.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { TEMPLATES, findTemplate } from "@workout-tracker/db";
import { programResponse, templatesResponse } from "@workout-tracker/shared";
import { listTemplates, startProgramFromTemplate } from "../src/index";
import { createProgramFromTemplate } from "../src/templates";
import { cleanup, db, newId, newUser, pool, rejectsWith, rowCount } from "./db";

after(cleanup);

const ppl = findTemplate("push-pull-legs")!;

/** Every row a program owns, level by level. */
async function treeCounts(programId: string) {
  const q = async (sql: string) => rowCount(sql, [programId]);
  return {
    programs: await q("SELECT 1 FROM workout_programs WHERE id = $1"),
    plans: await q("SELECT 1 FROM workout_plans WHERE program_id = $1"),
    workouts: await q(
      "SELECT 1 FROM workouts w JOIN workout_plans p ON p.id = w.plan_id WHERE p.program_id = $1",
    ),
    exercises: await q(
      `SELECT 1 FROM planned_exercises pe JOIN workouts w ON w.id = pe.workout_id
         JOIN workout_plans p ON p.id = w.plan_id WHERE p.program_id = $1`,
    ),
    sets: await q(
      `SELECT 1 FROM planned_sets ps JOIN planned_exercises pe ON pe.id = ps.planned_exercise_id
         JOIN workouts w ON w.id = pe.workout_id
         JOIN workout_plans p ON p.id = w.plan_id WHERE p.program_id = $1`,
    ),
  };
}

describe("listTemplates", () => {
  it("shows every template with its name, description, workouts and exercises", async () => {
    const user = await newUser();
    const result = templatesResponse.parse(await listTemplates(db, user));

    assert.deepEqual(
      result.templates.map((t) => t.slug),
      TEMPLATES.map((t) => t.slug),
    );
    for (const [i, t] of result.templates.entries()) {
      const source = TEMPLATES[i]!;
      assert.equal(t.name, source.name);
      assert.ok(t.description.length > 0);
      assert.deepEqual(
        t.workouts.map((w) => w.name),
        source.workouts.map((w) => w.name),
      );
      for (const w of t.workouts) {
        assert.ok(w.exercises.length > 0);
        for (const e of w.exercises) assert.ok(e.name.length > 0);
      }
    }
  });
});

describe("startProgramFromTemplate", () => {
  it("creates one ACTIVE open-ended program with one cycle in template order and no weights", async () => {
    const user = await newUser();
    const programId = newId();
    const result = programResponse.parse(
      await startProgramFromTemplate(db, user, {
        programId,
        templateSlug: "push-pull-legs",
      }),
    );
    assert.deepEqual(result.program, {
      id: programId,
      name: "Push Pull Legs",
      status: "ACTIVE",
      targetCycles: null,
      currentCycle: 1,
    });

    const { rows: programs } = await pool.query<{
      target_cycles: number | null;
      status: string;
      start_date: unknown;
    }>(
      "SELECT target_cycles, status, start_date FROM workout_programs WHERE user_id = $1",
      [user],
    );
    assert.equal(programs.length, 1);
    assert.equal(programs[0]!.target_cycles, null);
    assert.equal(programs[0]!.status, "ACTIVE");
    assert.ok(programs[0]!.start_date);

    const { rows: plans } = await pool.query(
      "SELECT cycle_number FROM workout_plans WHERE program_id = $1",
      [programId],
    );
    assert.deepEqual(plans, [{ cycle_number: 1 }]);

    const { rows: exercises } = await pool.query<{
      workout: string;
      wpos: number;
      exercise_id: string;
      pos: number;
      target_sets: number;
    }>(
      `SELECT w.name AS workout, w.position AS wpos, pe.exercise_id,
              pe.position AS pos, pe.target_sets
         FROM workouts w JOIN workout_plans p ON p.id = w.plan_id
         JOIN planned_exercises pe ON pe.workout_id = w.id
        WHERE p.program_id = $1 ORDER BY w.position, pe.position`,
      [programId],
    );
    const expected = ppl.workouts.flatMap((w, wpos) =>
      w.exercises.map((e, pos) => ({
        workout: w.name,
        wpos,
        exercise_id: e.exerciseId,
        pos,
        target_sets: e.targetSets,
      })),
    );
    assert.deepEqual(exercises, expected);

    const { rows: sets } = await pool.query<{
      n: number;
      weighted: number;
      bad_reps: number;
    }>(
      `SELECT count(*)::int AS n,
              count(*) FILTER (WHERE ps.target_weight IS NOT NULL OR ps.weight_unit IS NOT NULL)::int AS weighted,
              count(*) FILTER (WHERE ps.target_reps_min IS NULL OR ps.target_reps_max IS NULL)::int AS bad_reps
         FROM planned_sets ps JOIN planned_exercises pe ON pe.id = ps.planned_exercise_id
         JOIN workouts w ON w.id = pe.workout_id JOIN workout_plans p ON p.id = w.plan_id
        WHERE p.program_id = $1`,
      [programId],
    );
    const targetSets = ppl.workouts
      .flatMap((w) => w.exercises)
      .reduce((sum, e) => sum + e.targetSets, 0);
    assert.deepEqual(sets[0], { n: targetSets, weighted: 0, bad_reps: 0 });
  });

  it("is idempotent on the program id: a retried start creates nothing and answers the same", async () => {
    const user = await newUser();
    const input = { programId: newId(), templateSlug: "push-pull-legs" };
    const first = await startProgramFromTemplate(db, user, input);
    const before = await treeCounts(input.programId);
    const { rows: xmin1 } = await pool.query(
      "SELECT xmin::text FROM workout_programs WHERE id = $1",
      [input.programId],
    );

    const second = await startProgramFromTemplate(db, user, input);

    assert.deepEqual(second, first);
    assert.deepEqual(await treeCounts(input.programId), before);
    assert.equal(
      await rowCount("SELECT 1 FROM workout_programs WHERE user_id = $1", [
        user,
      ]),
      1,
    );
    const { rows: xmin2 } = await pool.query(
      "SELECT xmin::text FROM workout_programs WHERE id = $1",
      [input.programId],
    );
    assert.deepEqual(xmin2, xmin1, "the replay wrote nothing");
  });

  it("suffixes the name when the user already has it, and both stay ACTIVE", async () => {
    const user = await newUser();
    const a = await startProgramFromTemplate(db, user, {
      programId: newId(),
      templateSlug: "push-pull-legs",
    });
    const bInput = { programId: newId(), templateSlug: "push-pull-legs" };
    const b = await startProgramFromTemplate(db, user, bInput);
    const c = await startProgramFromTemplate(db, user, {
      programId: newId(),
      templateSlug: "push-pull-legs",
    });
    assert.equal(a.program.name, "Push Pull Legs");
    assert.equal(b.program.name, "Push Pull Legs (2)");
    assert.equal(c.program.name, "Push Pull Legs (3)");
    // A replay of the suffixed start is recognised by its suffixed name.
    assert.deepEqual(await startProgramFromTemplate(db, user, bInput), b);
    const { rows } = await pool.query(
      "SELECT DISTINCT status FROM workout_programs WHERE user_id = $1",
      [user],
    );
    assert.deepEqual(rows, [{ status: "ACTIVE" }]);
  });

  it("does not suffix against another user's program names", async () => {
    const other = await newUser();
    await startProgramFromTemplate(db, other, {
      programId: newId(),
      templateSlug: "full-body-3-day",
    });
    const user = await newUser();
    const mine = await startProgramFromTemplate(db, user, {
      programId: newId(),
      templateSlug: "full-body-3-day",
    });
    assert.equal(mine.program.name, "Full Body 3-Day");
  });

  it("leaves nothing behind when creation fails partway", async () => {
    const user = await newUser();
    const programId = newId();
    // Fails on the last level, planned_sets, after the program, plan, workouts
    // and planned exercises are written: reps min above max breaks a CHECK.
    const broken = {
      ...ppl,
      workouts: [
        ppl.workouts[0]!,
        {
          name: "Broken",
          exercises: [
            { ...ppl.workouts[1]!.exercises[0]!, repsMin: 9, repsMax: 3 },
          ],
        },
      ],
    };
    await rejectsWith(
      createProgramFromTemplate(db, user, programId, broken),
      "invalid",
    );
    assert.deepEqual(await treeCounts(programId), {
      programs: 0,
      plans: 0,
      workouts: 0,
      exercises: 0,
      sets: 0,
    });
    assert.equal(
      await rowCount("SELECT 1 FROM workout_programs WHERE user_id = $1", [
        user,
      ]),
      0,
    );
  });

  it("refuses an unknown template", async () => {
    const user = await newUser();
    await rejectsWith(
      startProgramFromTemplate(db, user, {
        programId: newId(),
        templateSlug: "no-such-template",
      }),
      "not_found",
    );
  });

  it("treats a program id that is another user's as a conflict, writing nothing", async () => {
    const owner = await newUser();
    const programId = newId();
    await startProgramFromTemplate(db, owner, {
      programId,
      templateSlug: "push-pull-legs",
    });
    const before = await treeCounts(programId);

    const intruder = await newUser();
    await rejectsWith(
      startProgramFromTemplate(db, intruder, {
        programId,
        templateSlug: "push-pull-legs",
      }),
      "conflict",
    );
    assert.deepEqual(await treeCounts(programId), before);
    assert.equal(
      await rowCount("SELECT 1 FROM workout_programs WHERE user_id = $1", [
        intruder,
      ]),
      0,
    );
  });
});
