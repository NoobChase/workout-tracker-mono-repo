// specs/program-builder (create) and specs/program-lifecycle (step-4a,
// design D3, D8, D10), against a real Neon branch.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { drizzle } from "drizzle-orm/neon-serverless";
import type { Db, UserId } from "@workout-tracker/db";
import {
  cycleDetailResponse,
  programDetailResponse,
  programListResponse,
  programResponse,
  type CreateProgramRequest,
} from "@workout-tracker/shared";
import {
  activateProgram,
  archiveProgram,
  copyProgram,
  createExercise,
  createProgram,
  extendProgram,
  getCycle,
  getProgram,
  listPrograms,
  renameProgram,
  whatsNext,
} from "../src/index";
import {
  Training,
  cleanup,
  db,
  newId,
  newUser,
  pool,
  rejectsWith,
  rowCount,
} from "./db";
import {
  create,
  cycle,
  editable,
  fingerprints,
  fixtures,
  ppl,
  save,
  treeCounts,
  workout,
  xmins,
} from "./trees";

after(cleanup);

async function status(programId: string) {
  const { rows } = await pool.query<{
    status: string;
    target_cycles: number | null;
  }>("SELECT status, target_cycles FROM workout_programs WHERE id = $1", [
    programId,
  ]);
  return rows[0];
}

/** Finishes every workout of cycle n, one session each. */
async function trainCycle(user: UserId, programId: string, n: number) {
  for (const w of await fixtures(user, programId, n)) {
    const t = await Training.start(user, w);
    if (w.exercises.length > 0) await t.log(0, 1, 5, 100);
    await t.finish();
  }
}

describe("createProgram", () => {
  it("creates a fixed program as a DRAFT with N identical cycles numbered 1..N", async () => {
    const user = await newUser();
    const { programId, response } = await create(user, {
      name: "Summer Strength",
      targetCycles: 12,
    });
    assert.deepEqual(programResponse.parse(response).program, {
      id: programId,
      name: "Summer Strength",
      status: "DRAFT",
      targetCycles: 12,
      currentCycle: 1,
    });
    const { rows } = await pool.query<{ cycle_number: number; n: number }>(
      `SELECT p.cycle_number, count(w.id)::int AS n FROM workout_plans p
         JOIN workouts w ON w.plan_id = p.id
        WHERE p.program_id = $1 GROUP BY p.cycle_number ORDER BY p.cycle_number`,
      [programId],
    );
    assert.deepEqual(
      rows,
      Array.from({ length: 12 }, (_, i) => ({ cycle_number: i + 1, n: 3 })),
    );
    const fps = await fingerprints(user, programId);
    assert.equal(new Set(fps).size, 1, "all 12 cycles are the same cycle");
    const { rows: start } = await pool.query<{ dated: boolean }>(
      "SELECT start_date IS NOT NULL AS dated FROM workout_programs WHERE id = $1",
      [programId],
    );
    assert.equal(start[0]!.dated, true);
  });

  it("creates an open-ended program with exactly one cycle and no cycle count", async () => {
    const user = await newUser();
    const { programId, response } = await create(user, {
      name: "Base Building",
      targetCycles: null,
    });
    assert.equal(response.program.targetCycles, null);
    assert.equal(response.program.status, "DRAFT");
    assert.equal((await treeCounts(programId)).plans, 1);
  });

  it("stores cycle 1 exactly as sent: ids, placeholders, partial prescriptions, supersets", async () => {
    const user = await newUser();
    const c = cycle([
      workout(
        0,
        "Upper",
        [
          {
            exercise: "Barbell Bench Press",
            sets: 4,
            group: 5,
            prescribed: [1, 2, 3].map(() => ({
              targetRepsMin: 8,
              targetRepsMax: 12,
              targetWeight: 135,
              weightUnit: "LB" as const,
            })),
          },
          { exercise: "Barbell Row", sets: 4, group: 5 },
          { label: "do something that feels good", sets: 3 },
        ],
        "Rest 2-3 min",
      ),
    ]);
    const { programId } = await create(user, { targetCycles: 1, cycle: c });
    const stored = await editable(user, programId, 1);
    assert.deepEqual(stored, c);
    const [bench, row, placeholder] = stored.workouts[0]!.plannedExercises;
    assert.equal(bench!.plannedSets.length, 3, "set 4 is freeform");
    assert.equal(bench!.groupKey, row!.groupKey);
    assert.equal(placeholder!.exerciseId, null);
    assert.equal(placeholder!.placeholderLabel, "do something that feels good");
  });

  it("is a no-op on replay: one program, the same answer, nothing rewritten", async () => {
    const user = await newUser();
    const { programId, input, response } = await create(user, {
      targetCycles: 3,
    });
    const before = await xmins(programId);

    const again = await createProgram(db, user, input);

    assert.deepEqual(again, response);
    assert.deepEqual(await xmins(programId), before);
    assert.equal(
      await rowCount("SELECT 1 FROM workout_programs WHERE user_id = $1", [
        user,
      ]),
      1,
    );
  });

  it("recognises a replay whose cycle-1 ids were re-minted, by fingerprint", async () => {
    const user = await newUser();
    const { input } = await create(user, { targetCycles: 2 });
    const reminted: CreateProgramRequest = {
      ...input,
      cycle: {
        id: newId(),
        workouts: input.cycle.workouts.map((w) => ({
          ...w,
          id: newId(),
          plannedExercises: w.plannedExercises.map((s) => ({
            ...s,
            id: newId(),
            plannedSets: s.plannedSets.map((p) => ({ ...p, id: newId() })),
          })),
        })),
      },
    };
    const again = await createProgram(db, user, reminted);
    assert.equal(again.program.id, input.programId);
    assert.equal((await treeCounts(input.programId)).plans, 2);
  });

  it("refuses the same program id with different content, writing nothing", async () => {
    const user = await newUser();
    const { programId, input } = await create(user, { targetCycles: 2 });
    const before = await xmins(programId);
    const different = { ...input, cycle: ppl() };
    different.cycle.workouts[0]!.name = "Chest";
    await rejectsWith(createProgram(db, user, different), "conflict");
    assert.deepEqual(await xmins(programId), before);
  });

  it("refuses the same program id with a different name or length, writing nothing", async () => {
    const user = await newUser();
    const { programId, input } = await create(user, {
      name: "Summer Strength",
      targetCycles: 2,
    });
    const before = await xmins(programId);
    for (const patch of [
      { name: "Winter Base" },
      { targetCycles: 3 },
      { targetCycles: null },
    ]) {
      const error = await rejectsWith(
        createProgram(db, user, { ...input, ...patch }),
        "conflict",
      );
      assert.equal(error.message, "That program id is already in use.");
    }
    assert.deepEqual(await xmins(programId), before);
    assert.deepEqual(await createProgram(db, user, input), {
      program: (await listPrograms(db, user)).programs[0],
    });
  });

  it("refuses another user's program id", async () => {
    const owner = await newUser();
    const { input } = await create(owner, { targetCycles: 1 });
    const intruder = await newUser();
    await rejectsWith(createProgram(db, intruder, input), "conflict");
    assert.equal(
      await rowCount("SELECT 1 FROM workout_programs WHERE user_id = $1", [
        intruder,
      ]),
      0,
    );
  });

  it("leaves nothing behind when it fails partway", async () => {
    const user = await newUser();
    // Passes the service's own checks; the planned_sets CHECK fails after
    // the program, plan, workouts and planned exercises are written.
    const broken = ppl();
    const set = broken.workouts[2]!.plannedExercises[0]!.plannedSets[0]!;
    set.targetRepsMin = 9;
    set.targetRepsMax = 3;
    const programId = newId();
    await rejectsWith(
      createProgram(db, user, {
        programId,
        name: "Broken",
        targetCycles: 12,
        cycle: broken,
      }),
      "invalid",
    );
    assert.deepEqual(await treeCounts(programId), {
      programs: 0,
      plans: 0,
      workouts: 0,
      exercises: 0,
      sets: 0,
    });
  });

  it("refuses another user's private exercise, naming the slot, and writes nothing", async () => {
    const owner = await newUser();
    const privateId = newId();
    await createExercise(db, owner, {
      id: privateId,
      name: "Secret Press",
      primaryMuscles: ["CHEST"],
      secondaryMuscles: [],
      equipment: "MACHINE",
      metrics: [
        { metric: "REPS", isRequired: true },
        { metric: "WEIGHT", isRequired: true },
      ],
    });
    const user = await newUser();
    const c = ppl();
    c.workouts[1]!.plannedExercises[0]!.exerciseId = privateId;
    const programId = newId();
    const error = await rejectsWith(
      createProgram(db, user, {
        programId,
        name: "Mine",
        targetCycles: 2,
        cycle: c,
      }),
      "invalid",
    );
    assert.match(error.message, /Pull, exercise 1/);
    assert.equal((await treeCounts(programId)).programs, 0);
  });

  it("refuses a name the user already has, naming it, and creates nothing", async () => {
    const user = await newUser();
    await create(user, { name: "Summer Strength", targetCycles: 1 });
    const programId = newId();
    const error = await rejectsWith(
      createProgram(db, user, {
        programId,
        name: "Summer Strength",
        targetCycles: 12,
        cycle: ppl(),
      }),
      "conflict",
    );
    assert.match(error.message, /"Summer Strength"/);
    assert.equal((await treeCounts(programId)).programs, 0);
  });
});

describe("program reads", () => {
  it("lists every status, never another user's programs", async () => {
    const other = await newUser();
    await create(other, { name: "Theirs" });
    const user = await newUser();
    const draft = await create(user, { name: "Draft" });
    const a = await create(user, { name: "Active A" });
    const b = await create(user, { name: "Active B" });
    const archived = await create(user, { name: "Old" });
    await activateProgram(db, user, a.programId);
    await activateProgram(db, user, b.programId);
    await archiveProgram(db, user, archived.programId);

    const list = programListResponse.parse(await listPrograms(db, user));
    assert.deepEqual(list.programs.map((p) => [p.name, p.status]).sort(), [
      ["Active A", "ACTIVE"],
      ["Active B", "ACTIVE"],
      ["Draft", "DRAFT"],
      ["Old", "ARCHIVED"],
    ]);
    assert.equal(
      list.programs.find((p) => p.id === draft.programId)!.currentCycle,
      1,
    );
  });

  it("reads 'cycle n of N' for a fixed program and 'cycle n' for an open-ended one", async () => {
    const user = await newUser();
    const fixed = await create(user, {
      targetCycles: 3,
      cycle: cycle([workout(0, "Run", [{ exercise: "Back Squat", sets: 1 }])]),
    });
    const open = await create(user, {
      targetCycles: null,
      cycle: cycle([workout(0, "Lift", [{ exercise: "Back Squat", sets: 1 }])]),
    });
    await activateProgram(db, user, fixed.programId);
    await activateProgram(db, user, open.programId);
    await trainCycle(user, fixed.programId, 1);
    for (const n of [1, 2, 3]) await trainCycle(user, open.programId, n);

    const list = await listPrograms(db, user);
    const byId = new Map(list.programs.map((p) => [p.id, p]));
    assert.deepEqual(
      [
        byId.get(fixed.programId)!.currentCycle,
        byId.get(fixed.programId)!.targetCycles,
      ],
      [2, 3],
    );
    assert.deepEqual(
      [
        byId.get(open.programId)!.currentCycle,
        byId.get(open.programId)!.targetCycles,
      ],
      [4, null],
      "open-ended, in its fourth cycle: 'Cycle 4' with no total",
    );
  });

  it("has no current cycle once a fixed program is COMPLETED", async () => {
    const user = await newUser();
    const p = await create(user, {
      targetCycles: 1,
      cycle: cycle([workout(0, "Only", [{ exercise: "Back Squat", sets: 1 }])]),
    });
    await activateProgram(db, user, p.programId);
    await trainCycle(user, p.programId, 1);
    const [summary] = (await listPrograms(db, user)).programs;
    assert.deepEqual(
      [summary!.status, summary!.currentCycle],
      ["COMPLETED", null],
    );
  });

  it("issues the same number of statements for one program as for five", async () => {
    let statements = 0;
    // The services only use the query builder, so no schema is needed.
    const counting = drizzle({
      client: pool,
      logger: { logQuery: () => void statements++ },
    }) as unknown as Db;
    const one = await newUser();
    await create(one, { targetCycles: 2 });
    const five = await newUser();
    for (let i = 0; i < 5; i++) await create(five, { targetCycles: 2 });

    statements = 0;
    assert.equal((await listPrograms(counting, one)).programs.length, 1);
    const forOne = statements;
    statements = 0;
    assert.equal((await listPrograms(counting, five)).programs.length, 5);
    assert.equal(statements, forOne);
    assert.ok(forOne <= 2, `one query per level, got ${forOne}`);
  });

  it("flags a cycle fullyTrained only once every workout has a session, in the same statements", async () => {
    let statements = 0;
    const counting = drizzle({
      client: pool,
      logger: { logQuery: () => void statements++ },
    }) as unknown as Db;
    const user = await newUser();
    const { programId } = await create(user, { targetCycles: 3 });
    await activateProgram(db, user, programId);
    const [push, pull, legs] = await fixtures(user, programId, 1);
    const flags = async () =>
      (await getProgram(db, user, programId)).cycles.map((c) => [
        c.trained,
        c.fullyTrained,
      ]);

    await Training.start(user, push!);
    await Training.start(user, pull!);
    assert.deepEqual(await flags(), [
      [true, false],
      [false, false],
      [false, false],
    ]);

    // Any status counts: a skipped-or-abandoned session is still a session,
    // so a second session on a workout must not be counted twice.
    await Training.start(user, pull!);
    await Training.start(user, legs!);
    assert.deepEqual(await flags(), [
      [true, true],
      [false, false],
      [false, false],
    ]);

    statements = 0;
    await getProgram(counting, user, programId);
    const forThree = statements;
    const other = await newUser();
    const small = await create(other, { targetCycles: 1 });
    statements = 0;
    await getProgram(counting, other, small.programId);
    assert.equal(statements, forThree, "no query per cycle");
  });

  it("flags trained cycles in the detail and trained workouts in the cycle", async () => {
    const user = await newUser();
    const { programId } = await create(user, { targetCycles: 3 });
    await activateProgram(db, user, programId);
    const [push] = await fixtures(user, programId, 1);
    await Training.start(user, push!); // IN_PROGRESS counts as trained

    const detail = programDetailResponse.parse(
      await getProgram(db, user, programId),
    );
    assert.deepEqual(detail.cycles, [
      { cycleNumber: 1, trained: true, fullyTrained: false },
      { cycleNumber: 2, trained: false, fullyTrained: false },
      { cycleNumber: 3, trained: false, fullyTrained: false },
    ]);
    const c1 = cycleDetailResponse.parse(
      await getCycle(db, user, programId, 1),
    );
    assert.deepEqual(
      c1.cycle.workouts.map((w) => [w.name, w.trained]),
      [
        ["Push", true],
        ["Pull", false],
        ["Legs", false],
      ],
    );
    assert.equal(
      c1.cycle.workouts[0]!.plannedExercises[0]!.plannedSets[0]!.targetWeight,
      135,
    );
  });

  it("dates a trained workout by its earliest session of any status, null when untrained", async () => {
    const user = await newUser();
    const { programId } = await create(user, { targetCycles: 2 });
    await activateProgram(db, user, programId);
    const [push, pull] = await fixtures(user, programId, 1);
    const earlier = "2026-03-02T09:30:00.000Z";
    const later = "2026-03-09T09:30:00.000Z";
    const resolved = await Training.start(user, push!, earlier);
    await resolved.log(0, 1, 5, 135);
    await resolved.finish();
    await Training.start(user, push!, later); // IN_PROGRESS, later
    await Training.start(user, pull!, later); // IN_PROGRESS only

    const c1 = cycleDetailResponse.parse(
      await getCycle(db, user, programId, 1),
    );
    assert.deepEqual(
      c1.cycle.workouts.map((w) => [w.name, w.trained, w.trainedAt]),
      [
        ["Push", true, earlier],
        ["Pull", true, later],
        ["Legs", false, null],
      ],
    );
    const c2 = cycleDetailResponse.parse(
      await getCycle(db, user, programId, 2),
    );
    assert.ok(
      c2.cycle.workouts.every((w) => !w.trained && w.trainedAt === null),
    );
  });

  it("hides another user's program and cycles", async () => {
    const owner = await newUser();
    const { programId } = await create(owner, { targetCycles: 2 });
    const intruder = await newUser();
    assert.deepEqual((await listPrograms(db, intruder)).programs, []);
    await rejectsWith(getProgram(db, intruder, programId), "not_found");
    await rejectsWith(getCycle(db, intruder, programId, 1), "not_found");
    await rejectsWith(getCycle(db, owner, programId, 9), "not_found");
  });
});

describe("program lifecycle", () => {
  it("activating a second program leaves the first ACTIVE and both are next", async () => {
    const user = await newUser();
    const lifting = await create(user, { name: "Lifting" });
    const running = await create(user, {
      name: "Running",
      cycle: cycle([
        workout(0, "Easy Run", [{ label: "30 min easy", sets: 1 }]),
      ]),
    });
    await activateProgram(db, user, lifting.programId);
    const before = await xmins(lifting.programId);

    const result = programResponse.parse(
      await activateProgram(db, user, running.programId),
    );

    assert.equal(result.program.status, "ACTIVE");
    assert.deepEqual(await xmins(lifting.programId), before, "untouched");
    assert.equal((await status(lifting.programId))!.status, "ACTIVE");
    assert.deepEqual(
      (await whatsNext(db, user)).next.map((n) => n.programName).sort(),
      ["Lifting", "Running"],
    );
  });

  it("activates an ARCHIVED program, is a no-op on an ACTIVE one, and refuses a COMPLETED one", async () => {
    const user = await newUser();
    const p = await create(user, {
      targetCycles: 1,
      cycle: cycle([workout(0, "Only", [{ exercise: "Back Squat", sets: 1 }])]),
    });
    await archiveProgram(db, user, p.programId);
    assert.equal(
      (await activateProgram(db, user, p.programId)).program.status,
      "ACTIVE",
    );
    const before = await xmins(p.programId);
    await activateProgram(db, user, p.programId);
    assert.deepEqual(await xmins(p.programId), before);

    await trainCycle(user, p.programId, 1);
    assert.equal((await status(p.programId))!.status, "COMPLETED");
    await rejectsWith(activateProgram(db, user, p.programId), "invalid");
  });

  it("activating an ARCHIVED program whose workouts were all resolved leaves it something next", async () => {
    for (const targetCycles of [null, 1]) {
      const user = await newUser();
      const p = await create(user, {
        targetCycles,
        cycle: cycle([
          workout(0, "A", [{ exercise: "Back Squat", sets: 1 }]),
          workout(1, "B", [{ exercise: "Barbell Row", sets: 1 }]),
        ]),
      });
      await activateProgram(db, user, p.programId);
      const [a, b] = await fixtures(user, p.programId, 1);
      await (await Training.start(user, a!)).finish();
      // B was started before the archive and finished after it: the finish
      // neither extends nor completes an ARCHIVED program (4.13).
      const late = await Training.start(user, b!);
      await archiveProgram(db, user, p.programId);
      await late.finish();
      assert.deepEqual(await status(p.programId), {
        status: "ARCHIVED",
        target_cycles: targetCycles,
      });

      const result = programResponse.parse(
        await activateProgram(db, user, p.programId),
      );

      if (targetCycles === null) {
        // Open-ended: extended in the activation's transaction.
        assert.equal(result.program.status, "ACTIVE");
        assert.equal(result.program.currentCycle, 2);
        assert.equal((await treeCounts(p.programId)).plans, 2);
        const next = await whatsNext(db, user);
        assert.equal(next.next[0]!.cycleNumber, 2);
        assert.equal(next.next[0]!.workoutName, "A");
      } else {
        // Fixed: every cycle is trained, so it is COMPLETED, never an ACTIVE
        // program with nothing next.
        assert.equal(result.program.status, "COMPLETED");
        assert.equal((await treeCounts(p.programId)).plans, 1);
        assert.deepEqual((await whatsNext(db, user)).next, []);
      }
    }
  });

  it("archives an ACTIVE program halfway: ARCHIVED, not COMPLETED, history kept, out of what's next", async () => {
    const user = await newUser();
    const { programId } = await create(user, { targetCycles: 2 });
    await activateProgram(db, user, programId);
    await trainCycle(user, programId, 1);

    const result = await archiveProgram(db, user, programId);

    assert.equal(result.program.status, "ARCHIVED");
    assert.equal(
      await rowCount("SELECT 1 FROM workout_sessions WHERE user_id = $1", [
        user,
      ]),
      3,
    );
    assert.deepEqual((await whatsNext(db, user)).next, []);
  });

  it("archives a COMPLETED program as ARCHIVED, never COMPLETED", async () => {
    const user = await newUser();
    const p = await create(user, {
      targetCycles: 1,
      cycle: cycle([workout(0, "Only", [{ exercise: "Back Squat", sets: 1 }])]),
    });
    await activateProgram(db, user, p.programId);
    await trainCycle(user, p.programId, 1);
    assert.equal(
      (await archiveProgram(db, user, p.programId)).program.status,
      "ARCHIVED",
    );
    const draft = await create(user, { name: "Never started" });
    assert.equal(
      (await archiveProgram(db, user, draft.programId)).program.status,
      "ARCHIVED",
    );
  });

  it("copies into an independent DRAFT of the same length; editing the copy leaves the source alone", async () => {
    const user = await newUser();
    const source = await create(user, {
      name: "Summer Strength",
      targetCycles: 3,
    });
    await activateProgram(db, user, source.programId);
    await trainCycle(user, source.programId, 1);
    const sourceRows = await xmins(source.programId);
    const sourceFps = await fingerprints(user, source.programId);

    const newProgramId = newId();
    const copy = programResponse.parse(
      await copyProgram(db, user, source.programId, { newProgramId }),
    );
    assert.deepEqual(copy.program, {
      id: newProgramId,
      name: "Summer Strength (2)",
      status: "DRAFT",
      targetCycles: 3,
      currentCycle: 1,
    });
    assert.deepEqual(
      await fingerprints(user, newProgramId),
      sourceFps.map(() => sourceFps[0]),
    );
    const copyIds = Object.keys(await xmins(newProgramId));
    assert.ok(
      copyIds.every((id) => !(id in sourceRows)),
      "no shared rows",
    );

    await save(user, newProgramId, 1, (c) => {
      c.workouts[0]!.name = "Chest";
    });
    assert.deepEqual(await xmins(source.programId), sourceRows);
    assert.deepEqual(await fingerprints(user, source.programId), sourceFps);
  });

  it("suffixes the next free number, and a replayed copy writes once", async () => {
    const user = await newUser();
    const source = await create(user, {
      name: "Summer Strength",
      targetCycles: 2,
    });
    await create(user, { name: "Summer Strength (2)", targetCycles: 1 });
    const input = { newProgramId: newId() };
    const first = await copyProgram(db, user, source.programId, input);
    assert.equal(first.program.name, "Summer Strength (3)");
    const before = await xmins(input.newProgramId);

    const again = await copyProgram(db, user, source.programId, input);

    assert.deepEqual(again, first);
    assert.deepEqual(await xmins(input.newProgramId), before);
    assert.equal(
      await rowCount("SELECT 1 FROM workout_programs WHERE user_id = $1", [
        user,
      ]),
      3,
    );
  });

  it("recognises a copy replay by create's rule: the name or its suffix, the source's length, cycle 1 (design D17)", async () => {
    const user = await newUser();
    const source = await create(user, { name: "Winter", targetCycles: 2 });
    const copy = async (newProgramId: string) =>
      copyProgram(db, user, source.programId, {
        newProgramId,
        name: "Winter",
      });

    // Suffixed on the way in ("Winter" is the source's), still a replay.
    const renamed = { id: newId() };
    const first = await copy(renamed.id);
    assert.equal(first.program.name, "Winter (2)");
    const before = await xmins(renamed.id);
    assert.deepEqual(await copy(renamed.id), first);
    assert.deepEqual(await xmins(renamed.id), before);

    // Renamed since: no longer this copy.
    await renameProgram(db, user, renamed.id, { name: "Spring" });
    const renamedError = await rejectsWith(copy(renamed.id), "conflict");
    assert.equal(renamedError.message, "That program id is already in use.");

    // Its cycle 1 edited since: a different program under the id.
    const edited = newId();
    await copy(edited);
    await save(user, edited, 1, (c) => {
      c.workouts[0]!.name = "Chest";
    });
    const editedError = await rejectsWith(copy(edited), "conflict");
    assert.match(editedError.message, /A different program/);

    // The source extended since: the copy is no longer its length.
    const shorter = newId();
    await copy(shorter);
    await extendProgram(db, user, source.programId, { newPlanId: newId() });
    const lengthError = await rejectsWith(copy(shorter), "conflict");
    assert.equal(lengthError.message, "That program id is already in use.");
    assert.equal((await status(shorter))!.target_cycles, 2);
  });

  it("refuses a copy id that is a different program of the user's, writing nothing", async () => {
    const user = await newUser();
    const source = await create(user, { targetCycles: 2 });
    const other = await create(user, {
      targetCycles: 1,
      cycle: cycle([workout(0, "Full Body", [{ exercise: "Back Squat" }])]),
    });
    const before = await xmins(other.programId);

    const error = await rejectsWith(
      copyProgram(db, user, source.programId, {
        newProgramId: other.programId,
      }),
      "conflict",
    );

    assert.equal(error.message, "That program id is already in use.");
    assert.deepEqual(await xmins(other.programId), before);
    assert.equal(
      await rowCount("SELECT 1 FROM workout_programs WHERE user_id = $1", [
        user,
      ]),
      2,
    );
  });

  it("refuses to copy another user's program", async () => {
    const owner = await newUser();
    const { programId } = await create(owner);
    const intruder = await newUser();
    await rejectsWith(
      copyProgram(db, intruder, programId, { newProgramId: newId() }),
      "not_found",
    );
  });

  it("renames a program everywhere it shows, and refuses a clash by name", async () => {
    const user = await newUser();
    const base = await create(user, {
      name: "Base Building",
      targetCycles: null,
    });
    await create(user, { name: "Peaking", targetCycles: 1 });
    await activateProgram(db, user, base.programId);

    const renamed = await renameProgram(db, user, base.programId, {
      name: "Winter Base",
    });
    assert.equal(renamed.program.name, "Winter Base");
    assert.equal(
      (await whatsNext(db, user)).next[0]!.programName,
      "Winter Base",
    );

    const error = await rejectsWith(
      renameProgram(db, user, base.programId, { name: "Peaking" }),
      "conflict",
    );
    assert.match(error.message, /"Peaking"/);
    const before = await xmins(base.programId);
    await renameProgram(db, user, base.programId, { name: "Winter Base" });
    assert.deepEqual(
      await xmins(base.programId),
      before,
      "same name: no write",
    );
  });

  it("extends a COMPLETED fixed program by one cycle matching its last, ACTIVE again; a replay adds nothing", async () => {
    const user = await newUser();
    const p = await create(user, {
      targetCycles: 2,
      cycle: cycle([workout(0, "Only", [{ exercise: "Back Squat", sets: 2 }])]),
    });
    await activateProgram(db, user, p.programId);
    // Cycle 2 differs from cycle 1, so the clone is visibly of the last one.
    await save(user, p.programId, 2, (c) => {
      c.workouts[0]!.plannedExercises[0]!.targetSets = 5;
    });
    await trainCycle(user, p.programId, 1);
    await trainCycle(user, p.programId, 2);
    assert.equal((await status(p.programId))!.status, "COMPLETED");

    const input = { newPlanId: newId() };
    const result = await extendProgram(db, user, p.programId, input);

    assert.deepEqual(
      [
        result.program.status,
        result.program.targetCycles,
        result.program.currentCycle,
      ],
      ["ACTIVE", 3, 3],
    );
    const fps = await fingerprints(user, p.programId);
    assert.equal(fps.length, 3);
    assert.equal(fps[2], fps[1]);
    assert.notEqual(fps[2], fps[0]);
    const before = await xmins(p.programId);

    const again = await extendProgram(db, user, p.programId, input);

    assert.deepEqual(again, result);
    assert.deepEqual(await xmins(p.programId), before);
    assert.equal((await whatsNext(db, user)).next[0]!.cycleNumber, 3);
  });

  it("refuses to extend an open-ended program", async () => {
    const user = await newUser();
    const p = await create(user, { targetCycles: null });
    await rejectsWith(
      extendProgram(db, user, p.programId, { newPlanId: newId() }),
      "invalid",
    );
    assert.equal((await treeCounts(p.programId)).plans, 1);
  });

  it("refuses to extend a fixed program past 104 cycles, and extends to exactly 104", async () => {
    const user = await newUser();
    const p = await create(user, {
      targetCycles: 103,
      cycle: cycle([workout(0, "Only", [{ exercise: "Back Squat", sets: 1 }])]),
    });
    const last = await extendProgram(db, user, p.programId, {
      newPlanId: newId(),
    });
    assert.equal(last.program.targetCycles, 104);
    assert.equal((await treeCounts(p.programId)).plans, 104);
    const before = await xmins(p.programId);

    const refused = await rejectsWith(
      extendProgram(db, user, p.programId, { newPlanId: newId() }),
      "invalid",
    );
    assert.match(refused.message, /104 cycles/);
    assert.equal((await treeCounts(p.programId)).plans, 104);
    assert.deepEqual(await xmins(p.programId), before);
  });

  it("is not_found for every lifecycle write on another user's program", async () => {
    const owner = await newUser();
    const { programId } = await create(owner);
    const intruder = await newUser();
    const before = await xmins(programId);
    await rejectsWith(activateProgram(db, intruder, programId), "not_found");
    await rejectsWith(archiveProgram(db, intruder, programId), "not_found");
    await rejectsWith(
      renameProgram(db, intruder, programId, { name: "x" }),
      "not_found",
    );
    await rejectsWith(
      extendProgram(db, intruder, programId, { newPlanId: newId() }),
      "not_found",
    );
    assert.deepEqual(await xmins(programId), before);
  });
});
