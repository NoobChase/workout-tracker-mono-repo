// The cycle fingerprint's normalizer, as pure functions (design D6). Every
// included column must move the fingerprint; every excluded one must not. The
// stored-cycle side, against a real database, is fingerprint-stored.test.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { getTableColumns } from "drizzle-orm";
import {
  canonicalJson,
  cycleContentKey,
  cycleFingerprint,
  plannedExercises,
  plannedSets,
  workouts,
  type FingerprintInput,
  type FingerprintInputSet,
  type FingerprintInputSlot,
  type FingerprintInputWorkout,
} from "../src/index";

const BENCH = "01900000-0000-7000-8000-00000000b001";
const ROW = "01900000-0000-7000-8000-00000000b002";

/**
 * A cycle in which every fingerprinted column holds a value. Set 1 carries the
 * RPE target and set 2 the RIR one: a set holds at most one (D16).
 */
function base(): FingerprintInput {
  return {
    id: "01900000-0000-7000-8000-0000000a0000",
    name: "Base",
    notes: "plan notes",
    workouts: [
      {
        id: "01900000-0000-7000-8000-0000000a0001",
        name: "Push",
        position: 0,
        notes: "Rest 2 min",
        plannedExercises: [
          {
            id: "01900000-0000-7000-8000-0000000a0002",
            exerciseId: BENCH,
            position: 0,
            targetSets: 4,
            groupKey: 1,
            notes: "top set first",
            plannedSets: [
              {
                id: "01900000-0000-7000-8000-0000000a0003",
                setNumber: 1,
                targetRepsMin: 8,
                targetRepsMax: 12,
                targetWeight: "135.00",
                weightUnit: "LB",
                targetDurationSeconds: 60,
                targetDistance: "1.500",
                distanceUnit: "MI",
                targetRpe: "8.0",
                notes: "go heavy",
              },
              {
                setNumber: 2,
                targetRepsMin: 6,
                targetRepsMax: 10,
                targetRir: "2.0",
              },
            ],
          },
          {
            exerciseId: ROW,
            position: 1,
            targetSets: 3,
            groupKey: 1,
            plannedSets: [],
          },
          {
            placeholderLabel: "Quads",
            position: 2,
            targetSets: 3,
            groupKey: null,
            plannedSets: [],
          },
        ],
      },
      { name: "Pull", position: 1, plannedExercises: [] },
    ],
  };
}

const fp = cycleFingerprint;
const push = (t: FingerprintInput): FingerprintInputWorkout => t.workouts[0]!;
const bench = (t: FingerprintInput): FingerprintInputSlot =>
  push(t).plannedExercises[0]!;
const placeholder = (t: FingerprintInput): FingerprintInputSlot =>
  push(t).plannedExercises[2]!;
const set1 = (t: FingerprintInput): FingerprintInputSet =>
  bench(t).plannedSets[0]!;
const set2 = (t: FingerprintInput): FingerprintInputSet =>
  bench(t).plannedSets[1]!;

/** The fingerprint of `base()` after `edit`. */
function after(edit: (t: FingerprintInput) => void): string {
  const t = base();
  edit(t);
  return fp(t);
}

describe("cycleFingerprint", () => {
  it("is a SHA-256 hex digest and deterministic", () => {
    assert.match(fp(base()), /^[0-9a-f]{64}$/);
    assert.equal(fp(base()), fp(base()));
  });

  describe("changes for every included column", () => {
    const cases: [string, (t: FingerprintInput) => void][] = [
      ["workouts.name", (t) => (push(t).name = "Push A")],
      ["workouts.position", (t) => (t.workouts[1]!.position = 5)],
      ["workout added", (t) => t.workouts.push(base().workouts[1]!)],
      ["planned_exercises.exercise_id", (t) => (bench(t).exerciseId = ROW)],
      [
        "planned_exercises.placeholder_label",
        (t) => (placeholder(t).placeholderLabel = "Hamstrings"),
      ],
      [
        "exercise swapped for a placeholder",
        (t) => {
          bench(t).exerciseId = null;
          bench(t).placeholderLabel = "Bench";
        },
      ],
      ["planned_exercises.position", (t) => (placeholder(t).position = 7)],
      ["planned_exercises.target_sets", (t) => (bench(t).targetSets = 5)],
      [
        "planned_exercises.target_sets to null",
        (t) => (bench(t).targetSets = null),
      ],
      [
        "planned_exercises.group_key (split a group)",
        (t) => (push(t).plannedExercises[1]!.groupKey = 2),
      ],
      [
        "planned_exercises.group_key (join a group)",
        (t) => (placeholder(t).groupKey = 1),
      ],
      [
        "planned_exercises.group_key (ungroup)",
        (t) => (bench(t).groupKey = null),
      ],
      ["slot removed", (t) => push(t).plannedExercises.pop()],
      ["planned_sets.set_number", (t) => (set1(t).setNumber = 3)],
      ["planned_sets.target_reps_min", (t) => (set1(t).targetRepsMin = 9)],
      ["planned_sets.target_reps_max", (t) => (set1(t).targetRepsMax = 11)],
      ["planned_sets.target_weight", (t) => (set1(t).targetWeight = "140")],
      ["planned_sets.weight_unit", (t) => (set1(t).weightUnit = "KG")],
      [
        "planned_sets.target_duration_seconds",
        (t) => (set1(t).targetDurationSeconds = 90),
      ],
      ["planned_sets.target_distance", (t) => (set1(t).targetDistance = "2")],
      ["planned_sets.distance_unit", (t) => (set1(t).distanceUnit = "KM")],
      ["planned_sets.target_rpe", (t) => (set1(t).targetRpe = "8.5")],
      ["planned_sets.target_rir", (t) => (set2(t).targetRir = "2.5")],
      ["planned_sets.target_rir to null", (t) => (set2(t).targetRir = null)],
      [
        "an RPE target rewritten as the same number of RIR",
        (t) => {
          set1(t).targetRir = set1(t).targetRpe;
          set1(t).targetRpe = null;
        },
      ],
      ["planned set removed", (t) => bench(t).plannedSets.pop()],
    ];
    for (const [name, edit] of cases) {
      it(name, () => assert.notEqual(after(edit), fp(base())));
    }
  });

  describe("ignores every excluded column", () => {
    const cases: [string, (t: FingerprintInput) => void][] = [
      ["workout_plans.notes", (t) => (t.notes = "changed")],
      ["workout_plans.name", (t) => (t.name = "Deload")],
      ["workouts.notes", (t) => (push(t).notes = null)],
      ["planned_exercises.notes", (t) => (bench(t).notes = "elbows in")],
      ["planned_sets.notes", (t) => delete set1(t).notes],
      [
        "every id",
        (t) => {
          t.id = undefined;
          push(t).id = "01900000-0000-7000-8000-0000000affff";
          bench(t).id = undefined;
          set1(t).id = "01900000-0000-7000-8000-0000000afffe";
        },
      ],
    ];
    for (const [name, edit] of cases) {
      it(name, () => assert.equal(after(edit), fp(base())));
    }
  });

  describe("group keys are renumbered by first appearance per workout", () => {
    const keyed = (keys: (number | null)[]): FingerprintInput => ({
      workouts: [
        {
          name: "W",
          position: 0,
          plannedExercises: keys.map((groupKey, position) => ({
            exerciseId: BENCH,
            position,
            groupKey,
            plannedSets: [],
          })),
        },
      ],
    });

    it("{1,1} equals {7,7}", () => {
      assert.equal(fp(keyed([1, 1])), fp(keyed([7, 7])));
    });
    it("{1,1,2,2} equals {2,2,1,1}", () => {
      assert.equal(fp(keyed([1, 1, 2, 2])), fp(keyed([2, 2, 1, 1])));
    });
    it("null stays null: {1,1,null} differs from {1,1,2}", () => {
      assert.notEqual(fp(keyed([1, 1, null])), fp(keyed([1, 1, 2])));
    });
    it("membership still counts: {1,1,2} differs from {1,2,2}", () => {
      assert.notEqual(fp(keyed([1, 1, 2])), fp(keyed([1, 2, 2])));
    });
    it("each workout renumbers on its own", () => {
      const two = (a: number, b: number): FingerprintInput => ({
        workouts: [a, b].map((key, position) => ({
          name: `W${position}`,
          position,
          plannedExercises: [0, 1].map((p) => ({
            exerciseId: BENCH,
            position: p,
            groupKey: key,
            plannedSets: [],
          })),
        })),
      });
      assert.equal(fp(two(1, 2)), fp(two(3, 3)));
    });
  });

  describe("normalizes representation, not content", () => {
    it("numeric as number, short string or Drizzle's padded string", () => {
      const weights: (string | number)[] = [135, "135", "135.0", "135.00"];
      for (const w of weights) {
        assert.equal(
          after((t) => (set1(t).targetWeight = w)),
          fp(base()),
          `targetWeight ${JSON.stringify(w)}`,
        );
      }
      assert.equal(
        after((t) => {
          set1(t).targetDistance = 1.5;
          set1(t).targetRpe = 8;
          set2(t).targetRir = 2;
        }),
        fp(base()),
      );
    });

    it("rounds to the column's scale as Postgres does", () => {
      // target_weight is numeric(7,2): 135.004 is stored as 135.00,
      // 135.005 as 135.01.
      assert.equal(
        after((t) => (set1(t).targetWeight = 135.004)),
        fp(base()),
      );
      assert.equal(
        after((t) => (set1(t).targetWeight = 135.005)),
        after((t) => (set1(t).targetWeight = "135.01")),
      );
      assert.equal(
        after((t) => (set1(t).targetWeight = "99.999")),
        after((t) => (set1(t).targetWeight = 100)),
      );
      // target_rpe is numeric(3,1).
      assert.equal(
        after((t) => (set1(t).targetRpe = 0.1 + 0.2)),
        after((t) => (set1(t).targetRpe = "0.3")),
      );
      // target_rir is numeric(3,1) too: 2.04 is stored as 2.0, 2.05 as 2.1.
      assert.equal(
        after((t) => (set2(t).targetRir = 2.04)),
        fp(base()),
      );
      assert.equal(
        after((t) => (set2(t).targetRir = "2.05")),
        after((t) => (set2(t).targetRir = 2.1)),
      );
    });

    it("refuses a value that is not a decimal", () => {
      assert.throws(() => after((t) => (set1(t).targetWeight = "heavy")));
      assert.throws(() => after((t) => (set1(t).targetWeight = NaN)));
    });

    it("undefined and null are the same absence", () => {
      assert.equal(
        after((t) => {
          bench(t).placeholderLabel = null;
          placeholder(t).exerciseId = undefined;
          bench(t).plannedSets[1]!.targetWeight = null;
          bench(t).plannedSets[1]!.weightUnit = undefined;
        }),
        fp(base()),
      );
    });

    it("exercise ids compare case-insensitively", () => {
      assert.equal(
        after((t) => (bench(t).exerciseId = BENCH.toUpperCase())),
        fp(base()),
      );
    });

    it("array order does not matter; position and set number do", () => {
      assert.equal(
        after((t) => {
          bench(t).plannedSets.reverse();
          push(t).plannedExercises.reverse();
          t.workouts.reverse();
        }),
        fp(base()),
      );
    });
  });

  it("decides every plan-table column, so a new one cannot slip past", () => {
    // A migration adding a column to these tables fails here until the
    // normalizer -- and this list -- says whether it is authoring.
    const decided = {
      workouts: {
        included: ["name", "position"],
        excluded: ["id", "planId", "notes"],
      },
      plannedExercises: {
        included: [
          "exerciseId",
          "placeholderLabel",
          "position",
          "targetSets",
          "groupKey",
        ],
        excluded: ["id", "workoutId", "notes"],
      },
      plannedSets: {
        included: [
          "setNumber",
          "targetRepsMin",
          "targetRepsMax",
          "targetWeight",
          "weightUnit",
          "targetDurationSeconds",
          "targetDistance",
          "distanceUnit",
          "targetRpe",
          "targetRir",
        ],
        excluded: ["id", "plannedExerciseId", "notes", "targetWeightKg"],
      },
    };
    const tables = { workouts, plannedExercises, plannedSets };
    for (const [name, table] of Object.entries(tables)) {
      const d = decided[name as keyof typeof decided];
      assert.deepEqual(
        Object.keys(getTableColumns(table)).sort(),
        [...d.included, ...d.excluded].sort(),
        name,
      );
    }
  });
});

describe("cycleContentKey (the normalizer with notes)", () => {
  const key = (edit: (t: FingerprintInput) => void = () => {}) => {
    const t = base();
    edit(t);
    return cycleContentKey(t);
  };

  it("is deterministic and ignores ids and the plan row", () => {
    assert.equal(key(), key());
    assert.equal(
      key((t) => {
        t.id = undefined;
        t.name = "Deload";
        t.notes = "changed";
        push(t).id = "01900000-0000-7000-8000-0000000affff";
        set1(t).id = undefined;
      }),
      key(),
    );
  });

  it("changes with every workout, slot and set notes column", () => {
    const cases: [string, (t: FingerprintInput) => void][] = [
      ["workouts.notes", (t) => (push(t).notes = "Rest 3 min")],
      ["planned_exercises.notes", (t) => (bench(t).notes = "elbows in")],
      ["planned_sets.notes", (t) => (set1(t).notes = "go lighter")],
      ["a note added where there was none", (t) => (set2(t).notes = "slow")],
    ];
    for (const [name, edit] of cases) {
      assert.notEqual(key(edit), key(), name);
      // The fingerprint, the same normalizer without notes, does not move.
      assert.equal(after(edit), fp(base()), name);
    }
  });

  it("changes with authored content, like the fingerprint", () => {
    assert.notEqual(
      key((t) => (set1(t).targetRepsMax = 10)),
      key(),
    );
  });

  it("normalizes like the fingerprint: absent notes are null, order and representation don't count", () => {
    assert.equal(
      key((t) => (set2(t).notes = null)),
      key(),
    );
    assert.equal(
      key((t) => {
        set1(t).targetWeight = 135;
        bench(t).plannedSets.reverse();
        t.workouts.reverse();
      }),
      key(),
    );
  });
});

describe("canonicalJson", () => {
  it("sorts object keys at every depth and keeps array order", () => {
    assert.equal(
      canonicalJson({ b: 1, a: { d: [2, 1], c: null } }),
      '{"a":{"c":null,"d":[2,1]},"b":1}',
    );
  });
});

describe("@workout-tracker/db/fingerprint", () => {
  it("imports nothing but node:crypto, so a non-database process can use it", () => {
    const source = readFileSync(
      new URL("../src/fingerprint-core.ts", import.meta.url),
      "utf8",
    );
    const imports = [...source.matchAll(/^import .* from "([^"]+)";$/gm)].map(
      (m) => m[1],
    );
    assert.deepEqual(imports, ["node:crypto"]);
  });
});
