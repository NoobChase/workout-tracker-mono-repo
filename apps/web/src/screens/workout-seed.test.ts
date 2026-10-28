import { describe, expect, it } from "vitest";
import { contextFor } from "../test/fakes.js";
import type { ExerciseView, SetView } from "../local/session-view.js";
import { seed } from "./workout.js";

/** Bench from the test context: plan 3 × 5–8, last time 225 × 5 (one set). */
function bench(
  sets: Partial<SetView>[] = [],
  lastTime = contextFor().exercises[0]!.lastTime,
): ExerciseView {
  const planned = { ...contextFor().exercises[0]!, lastTime };
  return {
    planned,
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
});
