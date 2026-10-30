// The step-4a program contracts: the cycle tree, the program requests and
// responses. Valid payloads round-trip; each rule the specs name is refused
// with a message that says where, in the lifter's words.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import {
  applyPreviewResponse,
  copyProgramRequest,
  createProgramRequest,
  cycleDetailResponse,
  cycleNumberParam,
  cycleTree,
  duplicateIdMessage,
  extendProgramRequest,
  firstDuplicateId,
  newId,
  programDetailResponse,
  programLimits,
  programListResponse,
  programSummary,
  programResponse,
  renameProgramRequest,
  saveCycleRequest,
  saveCycleResponse,
  slotLabel,
  type CycleTreeInput,
} from "../src/index";
import {
  FP,
  FP2,
  SQUAT,
  fullCycle,
  messages,
  set,
  withSlot,
  type Cycle,
  type Slot,
} from "./fixtures";

describe("cycle tree", () => {
  it("round-trips a fully spelled-out cycle", () => {
    const c = fullCycle();
    assert.deepEqual(cycleTree.parse(c), c);
  });

  it("fills omitted optional columns with null", () => {
    const minimal: CycleTreeInput = {
      id: newId(),
      workouts: [
        {
          id: newId(),
          name: "Push",
          position: 0,
          plannedExercises: [
            {
              id: newId(),
              exerciseId: SQUAT,
              position: 0,
              targetSets: 3,
              plannedSets: [{ id: newId(), setNumber: 1, targetRepsMin: 5 }],
            },
          ],
        },
      ],
    };
    const parsed = cycleTree.parse(minimal);
    const slot = parsed.workouts[0]!.plannedExercises[0]!;
    assert.equal(parsed.workouts[0]!.notes, null);
    assert.equal(slot.placeholderLabel, null);
    assert.equal(slot.groupKey, null);
    assert.deepEqual(slot.plannedSets[0], {
      id: minimal.workouts[0]!.plannedExercises![0]!.plannedSets![0]!.id,
      setNumber: 1,
      targetRepsMin: 5,
      targetRepsMax: null,
      targetWeight: null,
      weightUnit: null,
      targetDurationSeconds: null,
      targetDistance: null,
      distanceUnit: null,
      targetRpe: null,
      targetRir: null,
      notes: null,
    });
  });

  it("accepts a partial prescription: 3 sets prescribed of 4", () => {
    assert.equal(cycleTree.safeParse(fullCycle()).success, true);
  });

  it("refuses a slot with both an exercise and a label", () => {
    assert.deepEqual(
      messages(cycleTree, withSlot(1, { placeholderLabel: "Quads" })),
      [
        "Bench Day, exercise 2: choose an exercise or a placeholder label, not both.",
      ],
    );
  });

  it("refuses a slot with neither an exercise nor a label", () => {
    assert.deepEqual(
      messages(cycleTree, withSlot(2, { placeholderLabel: null })),
      [
        "Bench Day, exercise 3: choose an exercise or write a placeholder label.",
      ],
    );
  });

  it("refuses a rep max below the rep min, naming workout, slot and set", () => {
    const c = withSlot(1, {
      plannedSets: [
        set(1),
        set(2),
        set(3, { targetRepsMin: 10, targetRepsMax: 6 }),
      ],
    });
    assert.deepEqual(messages(cycleTree, c), [
      "Bench Day, exercise 2, set 3: rep max is below rep min.",
    ]);
  });

  it("accepts an exact rep target (min = max)", () => {
    const c = withSlot(0, {
      plannedSets: [set(1, { targetRepsMin: 5, targetRepsMax: 5 })],
    });
    assert.equal(cycleTree.safeParse(c).success, true);
  });

  it("refuses a weight without a unit, and a distance without one", () => {
    const c = withSlot(0, {
      plannedSets: [
        set(1, { weightUnit: null }),
        set(2, { targetDistance: 100, distanceUnit: null }),
      ],
    });
    assert.deepEqual(messages(cycleTree, c), [
      "Bench Day, exercise 1, set 1: a weight needs a unit.",
      "Bench Day, exercise 1, set 2: a distance needs a unit.",
    ]);
  });

  it("accepts an RIR or an RPE target in half steps", () => {
    for (const patch of [
      { targetRir: 0 },
      { targetRir: 2.5 },
      { targetRir: 10 },
      { targetRpe: 1 },
      { targetRpe: 8.5 },
      { targetRpe: 10 },
    ]) {
      const c = withSlot(0, { plannedSets: [set(1, patch)] });
      const parsed = cycleTree.parse(c);
      const s = parsed.workouts[0]!.plannedExercises[0]!.plannedSets[0]!;
      assert.equal(s.targetRir, patch.targetRir ?? null, JSON.stringify(patch));
      assert.equal(s.targetRpe, patch.targetRpe ?? null, JSON.stringify(patch));
    }
  });

  it("refuses a set with both an RIR and an RPE, naming workout, slot and set", () => {
    const c = withSlot(0, {
      plannedSets: [set(1), set(2), set(3, { targetRir: 2, targetRpe: 8 })],
    });
    assert.deepEqual(messages(cycleTree, c), [
      "Bench Day, exercise 1, set 3: choose an RPE or an RIR target, not both.",
    ]);
  });

  it("refuses more prescribed sets than the target", () => {
    const c = withSlot(0, {
      targetSets: 2,
      plannedSets: [set(1), set(2), set(3)],
    });
    assert.deepEqual(messages(cycleTree, c), [
      "Bench Day, exercise 1: 3 sets are prescribed but the target is 2.",
    ]);
  });

  it("refuses set numbers that repeat, skip, or start above 1", () => {
    for (const numbers of [[1, 1], [1, 3], [2]]) {
      const c = withSlot(0, { plannedSets: numbers.map((n) => set(n)) });
      assert.deepEqual(
        messages(cycleTree, c),
        [
          `Bench Day, exercise 1: prescribed sets must be numbered 1 to ${numbers.length}, each once.`,
        ],
        JSON.stringify(numbers),
      );
    }
  });

  it("refuses a target of zero sets", () => {
    assert.equal(
      cycleTree.safeParse(withSlot(2, { targetSets: 0 })).success,
      false,
    );
  });

  it("names the slot by position order, not array order", () => {
    const c = fullCycle();
    const slots = c.workouts[0]!.plannedExercises;
    // Send them reversed: the label slot (position 2) first.
    c.workouts[0]!.plannedExercises = [
      { ...slots[2]!, placeholderLabel: null },
      slots[1]!,
      slots[0]!,
    ];
    assert.deepEqual(messages(cycleTree, c), [
      "Bench Day, exercise 3: choose an exercise or write a placeholder label.",
    ]);
  });

  it("refuses two workouts or two slots in the same place", () => {
    const c = fullCycle();
    c.workouts[1]!.position = 0;
    assert.deepEqual(messages(cycleTree, c), [
      "Bench Day and Leg Day are in the same place in the cycle.",
    ]);
    const d = withSlot(2, { position: 1 });
    assert.deepEqual(messages(cycleTree, d), [
      "Bench Day: exercises 2 and 3 are in the same place.",
    ]);
  });

  it("refuses an id used twice in the tree", () => {
    const c = fullCycle();
    const dup = c.workouts[0]!.id;
    c.workouts[1]!.plannedExercises[0]!.id = dup;
    assert.deepEqual(messages(cycleTree, c), [
      `The id ${dup} is used twice in this cycle.`,
    ]);
  });

  it("refuses an empty cycle and a blank workout name", () => {
    assert.deepEqual(messages(cycleTree, { id: newId(), workouts: [] }), [
      "A cycle needs at least one workout.",
    ]);
    const c = fullCycle();
    c.workouts[0]!.name = "  ";
    assert.deepEqual(messages(cycleTree, c), ["Give every workout a name."]);
  });

  it("refuses non-v7 ids at every level, but takes any exercise id", () => {
    const mutations: ((c: Cycle) => void)[] = [
      (c) => (c.id = randomUUID()),
      (c) => (c.workouts[0]!.id = randomUUID()),
      (c) => (c.workouts[0]!.plannedExercises[0]!.id = randomUUID()),
      (c) =>
        (c.workouts[0]!.plannedExercises[0]!.plannedSets[0]!.id = randomUUID()),
    ];
    for (const [i, mutate] of mutations.entries()) {
      const c = fullCycle();
      mutate(c);
      assert.equal(cycleTree.safeParse(c).success, false, `mutation ${i}`);
    }
  });

  it("refuses out-of-range targets", () => {
    const bad: Record<string, unknown>[] = [
      { targetRepsMin: -1 },
      { targetWeight: 100.123 },
      { targetRpe: 11 },
      { targetRpe: 7.25 },
      { targetRpe: 7.2 },
      { targetRpe: 0.5 },
      { targetRpe: 0 },
      { targetRir: -0.5 },
      { targetRir: 10.5 },
      { targetRir: 2.2 },
      { targetDurationSeconds: 1.5 },
      { targetDistance: 1.0005, distanceUnit: "KM" },
      { weightUnit: "STONE" },
    ];
    for (const patch of bad) {
      const c = withSlot(0, { plannedSets: [set(1, patch)] });
      assert.equal(
        cycleTree.safeParse(c).success,
        false,
        JSON.stringify(patch),
      );
    }
  });
});

describe("slot labels and duplicate ids, shared with the services", () => {
  it("labels a slot by position order, whatever the array order", () => {
    const w = {
      name: "Push",
      plannedExercises: [{ position: 7 }, { position: 2 }, { position: 4 }],
    };
    assert.deepEqual(
      w.plannedExercises.map((s) => slotLabel(w, s)),
      ["Push, exercise 3", "Push, exercise 1", "Push, exercise 2"],
    );
  });

  it("finds the first id used twice at any level, or nothing", () => {
    const c = fullCycle();
    assert.equal(firstDuplicateId(c), undefined);
    const bench = c.workouts[0]!.plannedExercises[0]!;
    bench.plannedSets[1]!.id = bench.plannedSets[0]!.id;
    assert.equal(firstDuplicateId(c), bench.plannedSets[0]!.id);
    const d = fullCycle();
    d.workouts[1]!.id = d.id;
    assert.equal(firstDuplicateId(d), d.id);
    assert.equal(
      duplicateIdMessage(d.id),
      `The id ${d.id} is used twice in this cycle.`,
    );
  });
});

describe("size bounds (design D17)", () => {
  /** A minimal valid slot at `position` with `n` prescribed sets. */
  function bareSlot(position: number, targetSets = 3, n = 0): Slot {
    return {
      id: newId(),
      exerciseId: randomUUID(),
      placeholderLabel: null,
      position,
      targetSets,
      groupKey: null,
      notes: null,
      plannedSets: Array.from({ length: n }, (_, i) => set(i + 1)),
    };
  }
  function workoutAt(position: number, slots: Slot[] = [bareSlot(0)]) {
    return {
      id: newId(),
      name: `Day ${position + 1}`,
      position,
      notes: null,
      plannedExercises: slots,
    };
  }

  it("takes a cycle at every limit", () => {
    const max = programLimits;
    const c: Cycle = {
      id: newId(),
      workouts: Array.from({ length: max.workoutsPerCycle }, (_, i) =>
        workoutAt(
          i,
          i === 0
            ? Array.from({ length: max.exercisesPerWorkout }, (_, k) =>
                bareSlot(
                  k,
                  max.setsPerExercise,
                  k === 0 ? max.setsPerExercise : 0,
                ),
              )
            : undefined,
        ),
      ),
    };
    assert.deepEqual(cycleTree.parse(c), c);
    const create = {
      programId: newId(),
      name: "Two Years",
      targetCycles: max.targetCycles,
      cycle: fullCycle(),
    };
    assert.deepEqual(createProgramRequest.parse(create), create);
  });

  it("refuses 15 workouts in a cycle", () => {
    const c: Cycle = {
      id: newId(),
      workouts: Array.from({ length: 15 }, (_, i) => workoutAt(i)),
    };
    assert.deepEqual(messages(cycleTree, c), [
      "A cycle can have at most 14 workouts.",
    ]);
  });

  it("refuses 41 exercises in a workout, naming it", () => {
    const c: Cycle = {
      id: newId(),
      workouts: [
        workoutAt(
          0,
          Array.from({ length: 41 }, (_, k) => bareSlot(k)),
        ),
      ],
    };
    assert.deepEqual(messages(cycleTree, c), [
      "Day 1 has 41 exercises; a workout can have at most 40.",
    ]);
  });

  it("refuses a target of 31 sets and 31 prescribed sets, naming the slot", () => {
    assert.deepEqual(messages(cycleTree, withSlot(1, { targetSets: 31 })), [
      "Bench Day, exercise 2: the target can be at most 30 sets.",
    ]);
    assert.deepEqual(
      messages(
        cycleTree,
        withSlot(1, {
          targetSets: 31,
          plannedSets: Array.from({ length: 31 }, (_, i) => set(i + 1)),
        }),
      ),
      [
        "Bench Day, exercise 2: the target can be at most 30 sets.",
        "Bench Day, exercise 2: at most 30 sets can be prescribed.",
      ],
    );
  });

  /** A one-workout cycle that writes exactly `rows` rows (workout, slots, sets). */
  function cycleOfRows(rows: number): Cycle {
    const slotCount = Math.min(programLimits.exercisesPerWorkout, rows - 1);
    let sets = rows - 1 - slotCount;
    const slots = Array.from({ length: slotCount }, (_, k) => {
      const n = Math.min(programLimits.setsPerExercise, sets);
      sets -= n;
      return bareSlot(k, Math.max(n, 1), n);
    });
    assert.equal(sets, 0);
    return { id: newId(), workouts: [workoutAt(0, slots)] };
  }
  const bigCreate = (targetCycles: number | null, rows: number) => ({
    programId: newId(),
    name: "Big",
    targetCycles,
    cycle: cycleOfRows(rows),
  });

  it("takes a create of exactly 20,000 rows and refuses one more cycle's worth", () => {
    const limit = programLimits.rowsPerProgram;
    assert.equal(limit, 20_000);
    // 100 cycles of 200 rows is exactly the limit; 201 rows is 100 over it.
    const atLimit = bigCreate(100, 200);
    assert.deepEqual(createProgramRequest.parse(atLimit), atLimit);
    assert.deepEqual(messages(createProgramRequest, bigCreate(100, 201)), [
      "This program would be too large: 100 cycles of 201 workouts, exercises and sets come to 20100, over the limit of 20000. Use fewer cycles or a smaller cycle.",
    ]);
    // An open-ended create counts one cycle, and the largest legal cycle
    // (about 17,400 rows) is under the limit, so it is never refused.
    const largest = bigCreate(null, 41 + 40 * 30 - 40);
    assert.equal(createProgramRequest.safeParse(largest).success, true);
  });

  it("counts an open-ended create as one cycle and names the singular", () => {
    const parsed = createProgramRequest.parse(bigCreate(null, 300));
    assert.equal(parsed.targetCycles, null);
    assert.deepEqual(messages(createProgramRequest, bigCreate(104, 193)), [
      "This program would be too large: 104 cycles of 193 workouts, exercises and sets come to 20072, over the limit of 20000. Use fewer cycles or a smaller cycle.",
    ]);
    assert.equal(
      createProgramRequest.safeParse(bigCreate(104, 192)).success,
      true,
    );
  });

  it("refuses a create of 105 cycles, but reads a stored program extended past 104", () => {
    assert.deepEqual(
      messages(createProgramRequest, {
        programId: newId(),
        name: "Forever",
        targetCycles: 105,
        cycle: fullCycle(),
      }),
      [
        "A program can run at most 104 cycles. Choose open-ended to keep going.",
      ],
    );
    const extended = {
      id: newId(),
      name: "Forever",
      status: "ACTIVE",
      targetCycles: 105,
      currentCycle: 105,
    };
    assert.deepEqual(programSummary.parse(extended), extended);
  });
});

describe("program requests", () => {
  it("round-trips a fixed and an open-ended create", () => {
    for (const targetCycles of [12, null]) {
      const body = {
        programId: newId(),
        name: "Summer Strength",
        targetCycles,
        cycle: fullCycle(),
      };
      assert.deepEqual(createProgramRequest.parse(body), body);
    }
  });

  it("refuses zero cycles, a blank name and a non-v7 program id", () => {
    const body = {
      programId: newId(),
      name: "Summer Strength",
      targetCycles: 12,
      cycle: fullCycle(),
    };
    for (const patch of [
      { targetCycles: 0 },
      { targetCycles: 2.5 },
      { name: "   " },
      { programId: randomUUID() },
    ]) {
      assert.equal(
        createProgramRequest.safeParse({ ...body, ...patch }).success,
        false,
        JSON.stringify(patch),
      );
    }
  });

  it("trims a program name", () => {
    const parsed = renameProgramRequest.parse({ name: "  Winter Base " });
    assert.equal(parsed.name, "Winter Base");
  });

  it("round-trips a save with its expected fingerprints", () => {
    const body = {
      cycle: fullCycle(),
      expected: { source: FP },
      applyTo: [
        { cycleNumber: 6, fingerprint: FP },
        { cycleNumber: 7, fingerprint: FP2 },
      ],
    };
    assert.deepEqual(saveCycleRequest.parse(body), body);
    const alone = { cycle: fullCycle(), expected: { source: FP }, applyTo: [] };
    assert.deepEqual(saveCycleRequest.parse(alone), alone);
  });

  it("refuses a save that chooses a cycle twice, a bad fingerprint or cycle 0", () => {
    const base = { cycle: fullCycle(), expected: { source: FP } };
    assert.deepEqual(
      messages(saveCycleRequest, {
        ...base,
        applyTo: [
          { cycleNumber: 6, fingerprint: FP },
          { cycleNumber: 6, fingerprint: FP2 },
        ],
      }),
      ["A cycle is chosen twice."],
    );
    for (const patch of [
      { expected: { source: "not-a-hash" } },
      { applyTo: [{ cycleNumber: 6, fingerprint: "abc" }] },
      { applyTo: [{ cycleNumber: 0, fingerprint: FP }] },
      { applyTo: [{ cycleNumber: 6 }] },
      { applyTo: [6] },
    ]) {
      assert.equal(
        saveCycleRequest.safeParse({ ...base, applyTo: [], ...patch }).success,
        false,
        JSON.stringify(patch),
      );
    }
  });

  it("round-trips copy, rename and extend; ids must be v7", () => {
    const copy = { newProgramId: newId(), name: "Summer Strength (2)" };
    assert.deepEqual(copyProgramRequest.parse(copy), copy);
    const unnamed = { newProgramId: newId() };
    assert.deepEqual(copyProgramRequest.parse(unnamed), unnamed);
    assert.deepEqual(renameProgramRequest.parse({ name: "X" }), { name: "X" });
    const extend = { newPlanId: newId() };
    assert.deepEqual(extendProgramRequest.parse(extend), extend);

    assert.equal(
      copyProgramRequest.safeParse({ newProgramId: randomUUID() }).success,
      false,
    );
    assert.equal(
      extendProgramRequest.safeParse({ newPlanId: randomUUID() }).success,
      false,
    );
  });
});

describe("cycle number path segment", () => {
  it("reads digits as a cycle number and refuses anything else", () => {
    assert.equal(cycleNumberParam.parse("1"), 1);
    assert.equal(cycleNumberParam.parse("12"), 12);
    for (const bad of ["0", "-1", "1.5", "01", "x", "", "40000"]) {
      assert.equal(cycleNumberParam.safeParse(bad).success, false, bad);
    }
  });
});

describe("program responses", () => {
  const summary = {
    id: newId(),
    name: "Summer Strength",
    status: "ACTIVE",
    targetCycles: 12,
    currentCycle: 4,
  };

  it("round-trips the list, with fixed, open-ended and finished programs", () => {
    const body = {
      programs: [
        summary,
        {
          ...summary,
          id: newId(),
          status: "DRAFT",
          targetCycles: null,
          currentCycle: 1,
        },
        { ...summary, id: newId(), status: "COMPLETED", currentCycle: null },
        { ...summary, id: newId(), status: "ARCHIVED" },
      ],
    };
    assert.deepEqual(programListResponse.parse(body), body);
    assert.deepEqual(programResponse.parse({ program: summary }), {
      program: summary,
    });
    assert.equal(
      programResponse.safeParse({ program: { ...summary, status: "PAUSED" } })
        .success,
      false,
    );
  });

  it("round-trips the detail with per-cycle trained flags, both required", () => {
    const body = {
      program: summary,
      cycles: [
        { cycleNumber: 1, trained: true, fullyTrained: true },
        { cycleNumber: 2, trained: true, fullyTrained: false },
        { cycleNumber: 3, trained: false, fullyTrained: false },
      ],
    };
    assert.deepEqual(programDetailResponse.parse(body), body);
    assert.equal(
      programDetailResponse.safeParse({
        program: summary,
        cycles: [{ cycleNumber: 1, trained: true }],
      }).success,
      false,
    );
  });

  it("round-trips a cycle read with per-workout trained flags", () => {
    const c = fullCycle();
    const body = {
      programId: newId(),
      cycleNumber: 3,
      cycle: {
        id: c.id,
        workouts: c.workouts.map((w, i) => ({
          ...w,
          trained: i === 0,
          trainedAt: i === 0 ? "2026-03-02T09:30:00.000Z" : null,
        })),
      },
      fingerprint: FP,
    };
    assert.deepEqual(cycleDetailResponse.parse(body), body);
  });

  it("refuses a cycle read without trainedAt, or with a bad one", () => {
    const c = fullCycle();
    const body = (trainedAt?: unknown) => ({
      programId: newId(),
      cycleNumber: 1,
      fingerprint: FP,
      cycle: {
        id: c.id,
        workouts: c.workouts.map((w) => ({
          ...w,
          trained: false,
          ...(trainedAt === undefined ? {} : { trainedAt }),
        })),
      },
    });
    assert.equal(cycleDetailResponse.safeParse(body(null)).success, true);
    assert.equal(cycleDetailResponse.safeParse(body()).success, false);
    assert.equal(
      cycleDetailResponse.safeParse(body("last Tuesday")).success,
      false,
    );
  });

  it("round-trips a cycle read with its fingerprint, and refuses a missing or malformed one", () => {
    const c = fullCycle();
    const programId = newId();
    const body = (fingerprint: unknown) => ({
      programId,
      cycleNumber: 2,
      fingerprint,
      cycle: {
        id: c.id,
        workouts: c.workouts.map((w) => ({
          ...w,
          trained: false,
          trainedAt: null,
        })),
      },
    });
    assert.deepEqual(cycleDetailResponse.parse(body(FP)), body(FP));
    assert.equal(cycleDetailResponse.safeParse(body("abc")).success, false);
    assert.equal(cycleDetailResponse.safeParse(body(undefined)).success, false);
  });

  it("round-trips the apply preview and the save response", () => {
    const preview = {
      cycleNumber: 5,
      source: FP,
      later: [
        { cycleNumber: 6, fingerprint: FP, trained: false, matches: true },
        { cycleNumber: 9, fingerprint: FP2, trained: false, matches: false },
        { cycleNumber: 10, fingerprint: FP, trained: true, matches: true },
      ],
    };
    assert.deepEqual(applyPreviewResponse.parse(preview), preview);
    const saved = { cycleNumber: 5, applied: [6, 7, 8] };
    assert.deepEqual(saveCycleResponse.parse(saved), saved);
  });
});
