import { describe, expect, it } from "vitest";
import { contextFor } from "../../test/fakes.js";
import type { ExerciseView, SetView } from "../../local/session-view.js";
import { prescribedWeight, seed } from "./plan.js";

/** Bench from the test context: plan 3 × 5–8, last time 225 × 5 (one set). */
function bench(
  sets: Partial<SetView>[] = [],
  lastTime = contextFor().exercises[0]!.lastTime,
): ExerciseView {
  const planned = { ...contextFor().exercises[0]!, lastTime };
  return {
    planned,
    loggable: true,
    unit: "LB",
    sessionExerciseId: sets.length > 0 ? "se" : null,
    sets: sets.map((s, i) => ({
      id: `s${i}`,
      setNumber: i + 1,
      reps: 5,
      weight: 225,
      weightUnit: "LB",
      loggedAt: "2026-10-26T09:00:00.000Z",
      sync: { state: "logged" },
      ...s,
    })),
  };
}

const threeLastTime = {
  sessionId: "0192f0aa-0000-7000-8000-000000000000",
  performedAt: "2026-10-20T10:00:00.000Z",
  sets: [
    { setNumber: 1, reps: 5, weight: 225, weightUnit: "LB" as const },
    { setNumber: 2, reps: 5, weight: 225, weightUnit: "LB" as const },
    { setNumber: 3, reps: 4, weight: 225, weightUnit: "LB" as const },
  ],
};

describe("seed", () => {
  it("first set: last time's weight and reps for set 1", () => {
    expect(seed(bench())).toEqual({ weight: 225, reps: 5 });
  });

  it("first time on an exercise: blank weight, the plan's rep floor", () => {
    expect(seed(bench([], null))).toEqual({ weight: null, reps: 5 });
  });

  it("later sets: the weight just used; reps never below the plan's floor", () => {
    // Last time's set 3 was 4 reps, under the 5–8 plan: the floor wins.
    const view = bench(
      [
        { weight: 230, reps: 6 },
        { weight: 230, reps: 6 },
      ],
      threeLastTime,
    );
    expect(seed(view)).toEqual({ weight: 230, reps: 5 });
  });

  it("reps from last time's same set when it beat the floor", () => {
    const view = bench([{ reps: 8 }], {
      ...threeLastTime,
      sets: [
        { setNumber: 1, reps: 8, weight: 225, weightUnit: "LB" },
        { setNumber: 2, reps: 7, weight: 225, weightUnit: "LB" },
      ],
    });
    expect(seed(view).reps).toBe(7);
  });

  it("with no plan floor: last time's same set, else the last good set", () => {
    const noFloor = (sets: Partial<SetView>[], lastTime = threeLastTime) => {
      const view = bench(sets, lastTime);
      return {
        ...view,
        planned: {
          ...view.planned,
          plannedSets: view.planned.plannedSets.map((p) => ({
            ...p,
            repsMin: null,
            repsMax: null,
          })),
        },
      };
    };
    expect(seed(noFloor([{ reps: 9 }, { reps: 9 }])).reps).toBe(4);
    expect(
      seed(noFloor([{ reps: 9 }], { ...threeLastTime, sets: [] })).reps,
    ).toBe(9);
  });

  it("past last time's sets, reps fall back to the plan", () => {
    const view = bench([{ reps: 8 }, { reps: 8 }], {
      ...threeLastTime,
      sets: threeLastTime.sets.slice(0, 1),
    });
    expect(seed(view).reps).toBe(5);
  });

  it("never offers a weight the server rejected", () => {
    const view = bench([
      { weight: 225 },
      {
        weight: 2000,
        sync: { state: "rejected", reason: "Your trial has ended." },
      },
    ]);
    expect(seed(view).weight).toBe(225);
  });

  describe("a prescribed weight", () => {
    /** Bench with set weights written in the plan (a deload: 185, 185, 205). */
    const prescribed = (
      sets: Partial<SetView>[] = [],
      weights: (number | null)[] = [185, 185, 205],
      weightUnit: "LB" | "KG" = "LB",
      lastTime = threeLastTime,
    ): ExerciseView => {
      const view = bench(sets, lastTime);
      return {
        ...view,
        planned: {
          ...view.planned,
          plannedSets: view.planned.plannedSets.map((p, i) => ({
            ...p,
            weight: weights[i] ?? null,
            weightUnit: weights[i] == null ? null : weightUnit,
          })),
        },
      };
    };

    it("beats last time: a written deload is the seed", () => {
      // Last time was 225 × 5; the plan says 185.
      expect(seed(prescribed())).toEqual({ weight: 185, reps: 5 });
    });

    it("beats the weight just used, set by set", () => {
      const view = prescribed([{ weight: 190 }, { weight: 190 }]);
      expect(seed(view).weight).toBe(205);
    });

    it("an unprescribed set falls back to the weight just used, then last time", () => {
      expect(
        seed(prescribed([{ weight: 190 }], [185, null, null])).weight,
      ).toBe(190);
      expect(seed(prescribed([], [null, null, null])).weight).toBe(225);
    });

    it("past the plan's sets, an extra set carries the weight just used", () => {
      const view = prescribed([
        { weight: 185 },
        { weight: 185 },
        { weight: 205 },
      ]);
      expect(seed(view).weight).toBe(205);
      expect(prescribedWeight(view, 4)).toBeNull();
    });

    it("is converted when the plan wrote it in the other unit", () => {
      // 100 kg is 220.46 lb: a whole lb.
      expect(prescribedWeight(prescribed([], [100, 100, 100], "KG"), 1)).toBe(
        220,
      );
      // 225 lb is 102.06 kg: a half kg.
      const inKg = { ...prescribed(), unit: "KG" as const };
      expect(
        prescribedWeight(
          {
            ...inKg,
            planned: {
              ...inKg.planned,
              plannedSets: inKg.planned.plannedSets.map((p) => ({
                ...p,
                weight: 225,
                weightUnit: "LB" as const,
              })),
            },
          },
          1,
        ),
      ).toBe(102);
    });
  });
});
