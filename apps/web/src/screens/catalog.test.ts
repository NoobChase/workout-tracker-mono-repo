import { newId, type ExerciseListItem } from "@workout-tracker/shared";
import { describe, expect, it } from "vitest";
import { cycleRuns } from "./builder/apply-sheet.js";
import {
  exerciseMeta,
  filterExercises,
  metricsText,
  NO_FILTER,
  readRecent,
  rememberRecent,
} from "./catalog.js";

function exercise(
  name: string,
  over: Partial<ExerciseListItem> = {},
): ExerciseListItem {
  return {
    id: newId(),
    name,
    isCustom: false,
    isActive: true,
    primaryMuscles: [],
    secondaryMuscles: [],
    equipment: null,
    metrics: [
      { metric: "REPS", isRequired: true },
      { metric: "WEIGHT", isRequired: true },
    ],
    setup: null,
    cues: null,
    ...over,
  };
}

const LIST = [
  exercise("Back Squat", {
    primaryMuscles: ["QUADS", "GLUTES"],
    equipment: "BARBELL",
  }),
  exercise("Barbell Row", {
    primaryMuscles: ["UPPER_BACK"],
    equipment: "BARBELL",
  }),
  exercise("Romanian Deadlift", {
    primaryMuscles: ["HAMSTRINGS"],
    secondaryMuscles: ["QUADS"],
    equipment: "BARBELL",
  }),
  exercise("Seated Cable Row", {
    primaryMuscles: ["LATS"],
    equipment: "CABLE",
  }),
  exercise("Old Row", { isCustom: true, isActive: false, equipment: "CABLE" }),
];

const names = (list: ExerciseListItem[]) => list.map((e) => e.name);

describe("catalog filters (spec exercise-catalog, design D11)", () => {
  it("searches names in any case, anywhere in the name", () => {
    expect(
      names(filterExercises(LIST, { ...NO_FILTER, query: "ROW" })),
    ).toEqual(["Barbell Row", "Seated Cable Row"]);
  });

  it("filters by a primary or secondary muscle", () => {
    expect(
      names(filterExercises(LIST, { ...NO_FILTER, muscle: "QUADS" })),
    ).toEqual(["Back Squat", "Romanian Deadlift"]);
  });

  it("combines muscle, equipment and name", () => {
    expect(
      names(
        filterExercises(LIST, {
          ...NO_FILTER,
          query: "row",
          equipment: "CABLE",
        }),
      ),
    ).toEqual(["Seated Cable Row"]);
    expect(
      names(
        filterExercises(LIST, {
          ...NO_FILTER,
          muscle: "QUADS",
          equipment: "CABLE",
        }),
      ),
    ).toEqual([]);
  });

  it("hides retired exercises unless asked", () => {
    expect(names(filterExercises(LIST, NO_FILTER))).not.toContain("Old Row");
    expect(
      names(filterExercises(LIST, { ...NO_FILTER, showRetired: true })),
    ).toContain("Old Row");
  });

  it("describes a row and its metrics in words", () => {
    expect(exerciseMeta(LIST[0]!)).toBe("Quads, glutes · Barbell");
    expect(
      metricsText({
        metrics: [
          { metric: "REPS", isRequired: true },
          { metric: "WEIGHT", isRequired: false },
        ],
      }),
    ).toBe("Reps, weight (optional)");
  });

  it("remembers recent picks per user, newest first, without repeats", () => {
    rememberRecent("u1", "a");
    rememberRecent("u1", "b");
    rememberRecent("u1", "a");
    expect(readRecent("u1")).toEqual(["a", "b"]);
    expect(readRecent("u2")).toEqual([]);
    expect(readRecent(null)).toEqual([]);
  });
});

describe("cycle runs", () => {
  it("reads cycle numbers as runs", () => {
    expect(cycleRuns([6, 7, 8, 10, 11, 12])).toBe("6–8, 10–12");
    expect(cycleRuns([1, 2, 3, 4, 5])).toBe("1–5");
    expect(cycleRuns([3, 5])).toBe("3, 5");
    expect(cycleRuns([2, 3])).toBe("2, 3");
  });
});
