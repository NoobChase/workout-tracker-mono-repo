import {
  cycleTree,
  newId,
  type CycleDetailResponse,
} from "@workout-tracker/shared";
import { describe, expect, it } from "vitest";
import {
  addSlot,
  addWorkout,
  assignPositions,
  canMoveWorkout,
  fromCycle,
  groupLabels,
  moveSlot,
  moveWorkout,
  newProgram,
  rebase,
  removeSlot,
  removeWorkout,
  renameWorkout,
  setPerSet,
  setTargetSets,
  slotSummary,
  storedNode,
  supersetWithNext,
  toCycleTree,
  ungroup,
  updateLine,
  type BuilderState,
} from "./tree.js";

const BENCH = newId();
const ROW = newId();
const SQUAT = newId();
const CURL = newId();

/** Ids for a new slot, as the builder's action creator mints them. */
const slotIds = () => ({
  slot: newId(),
  lines: [newId(), newId(), newId()],
});
/** Enough fresh line ids for any growth to `n` sets. */
const lineIds = (n: number) => Array.from({ length: n }, () => newId());

function withSlots(...exercises: string[]): BuilderState {
  let s: BuilderState = newProgram(newId);
  for (const exerciseId of exercises) {
    s = addSlot(s, 0, { exerciseId }, slotIds());
  }
  return s;
}

const slotsOf = (s: BuilderState, wi = 0) => s.workouts[wi]!.slots;

/** A stored cycle: Push (trained), Legs, Pull, as the API returns it. */
function storedCycle(): CycleDetailResponse {
  const set = (n: number, reps: number, weight: number | null) => ({
    id: newId(),
    setNumber: n,
    targetRepsMin: reps,
    targetRepsMax: reps,
    targetWeight: weight,
    weightUnit: weight === null ? null : ("LB" as const),
    targetDurationSeconds: null,
    targetDistance: null,
    distanceUnit: null,
    targetRpe: null,
    targetRir: null,
    notes: null,
  });
  const slot = (
    exerciseId: string,
    position: number,
    sets: ReturnType<typeof set>[],
    targetSets = sets.length || 3,
  ) => ({
    id: newId(),
    exerciseId,
    placeholderLabel: null,
    position,
    targetSets,
    groupKey: null,
    notes: null,
    plannedSets: sets,
  });
  return {
    programId: newId(),
    cycleNumber: 2,
    fingerprint: "a".repeat(64),
    cycle: {
      id: newId(),
      workouts: [
        {
          id: newId(),
          name: "Push",
          position: 0,
          notes: "Rest 3 min",
          trained: true,
          trainedAt: "2026-10-20T13:00:00.000Z",
          plannedExercises: [
            slot(BENCH, 0, [set(1, 5, 225), set(2, 5, 225), set(3, 5, 225)]),
          ],
        },
        {
          id: newId(),
          name: "Legs",
          position: 2,
          notes: null,
          trained: false,
          trainedAt: null,
          plannedExercises: [
            // Four sets, three prescribed: set 4 is freeform.
            slot(SQUAT, 0, [set(1, 8, 135), set(2, 8, 135), set(3, 6, 155)], 4),
            slot(CURL, 1, []),
          ],
        },
        {
          id: newId(),
          name: "Pull",
          position: 5,
          notes: null,
          trained: false,
          trainedAt: null,
          plannedExercises: [slot(ROW, 0, [])],
        },
      ],
    },
  };
}

const load = (detail = storedCycle()) =>
  fromCycle(detail, { programName: "Summer", mint: newId });

describe("summaries", () => {
  it("reads sets × reps @ weight, ranges, and the effort target", () => {
    let s = withSlots(BENCH, ROW, SQUAT, CURL);
    s = setTargetSets(s, 0, 0, 5, lineIds(5));
    s = updateLine(
      s,
      0,
      0,
      "all",
      { repsMin: 5, repsMax: 5, weight: 225 },
      "LB",
    );
    s = updateLine(s, 0, 1, "all", { repsMin: 8, repsMax: 10 }, "LB");
    s = updateLine(s, 0, 2, "all", { repsMin: 5, repsMax: 5, effort: 2 }, "LB");
    expect(slotsOf(s).map(slotSummary)).toEqual([
      "5 × 5 @ 225 lb",
      "3 × 8–10",
      "3 × 5 @ RIR 2",
      "3 sets",
    ]);
    s = updateLine(s, 0, 0, "all", { effortKind: "RPE", effort: 8.5 }, "LB");
    expect(slotSummary(slotsOf(s)[0]!)).toBe("5 × 5 @ 225 lb · RPE 8.5");
  });

  it("says when sets are prescribed one by one", () => {
    let s = withSlots(BENCH);
    s = setPerSet(s, 0, 0, true);
    s = updateLine(s, 0, 0, 0, { repsMin: 5, weight: 185 }, "LB");
    s = updateLine(s, 0, 0, 1, { repsMin: 3, weight: 205 }, "LB");
    expect(slotSummary(slotsOf(s)[0]!)).toBe(
      "3 sets · 2 prescribed, the rest freeform",
    );
    s = updateLine(s, 0, 0, 2, { repsMin: 1, weight: 225 }, "LB");
    expect(slotSummary(slotsOf(s)[0]!)).toBe("3 sets · each set prescribed");
  });
});

describe("prescriptions", () => {
  it("one line for all writes every set; a typed weight takes the unit", () => {
    let s = withSlots(BENCH);
    s = updateLine(
      s,
      0,
      0,
      "all",
      { repsMin: 5, repsMax: 5, weight: 100 },
      "LB",
    );
    const tree = cycleTree.parse(toCycleTree(s));
    const sets = tree.workouts[0]!.plannedExercises[0]!.plannedSets;
    expect(
      sets.map((x) => [x.setNumber, x.targetWeight, x.weightUnit]),
    ).toEqual([
      [1, 100, "LB"],
      [2, 100, "LB"],
      [3, 100, "LB"],
    ]);
    // Ids are the lines' own, so a save keeps them.
    expect(new Set(sets.map((x) => x.id)).size).toBe(3);
  });

  it("a typed weight takes the unit it is given: the slot exercise's override", () => {
    let s = withSlots(BENCH, SQUAT);
    s = updateLine(s, 0, 0, "all", { weight: 100 }, "KG");
    s = updateLine(s, 0, 1, "all", { weight: 225 }, "LB");
    const [bench, squat] = cycleTree.parse(toCycleTree(s)).workouts[0]!
      .plannedExercises;
    expect(bench!.plannedSets.map((x) => x.weightUnit)).toEqual([
      "KG",
      "KG",
      "KG",
    ]);
    // No override on squat: the lifter's default.
    expect(squat!.plannedSets.map((x) => x.weightUnit)).toEqual([
      "LB",
      "LB",
      "LB",
    ]);
    // A weight already written keeps its unit when its reps change.
    s = updateLine(s, 0, 0, 0, { repsMin: 5 }, "LB");
    expect(slotsOf(s)[0]!.sets[0]!.weightUnit).toBe("KG");
  });

  it("an empty slot prescribes nothing; trailing freeform sets are left out", () => {
    let s = withSlots(BENCH);
    expect(
      toCycleTree(s).workouts[0]!.plannedExercises![0]!.plannedSets,
    ).toEqual([]);
    s = setTargetSets(s, 0, 0, 4, lineIds(4));
    s = setPerSet(s, 0, 0, true);
    for (const i of [0, 1, 2]) {
      s = updateLine(
        s,
        0,
        0,
        i,
        { repsMin: 8, repsMax: 12, weight: 135 },
        "LB",
      );
    }
    const sets = cycleTree.parse(toCycleTree(s)).workouts[0]!
      .plannedExercises[0]!.plannedSets;
    expect(sets.map((x) => x.setNumber)).toEqual([1, 2, 3]);
  });

  it("RIR and RPE are one or the other, never both", () => {
    let s = withSlots(BENCH);
    s = updateLine(s, 0, 0, "all", { effort: 2 }, "LB");
    s = updateLine(s, 0, 0, "all", { effortKind: "RPE" }, "LB");
    const set = cycleTree.parse(toCycleTree(s)).workouts[0]!
      .plannedExercises[0]!.plannedSets[0]!;
    expect([set.targetRpe, set.targetRir]).toEqual([2, null]);
  });

  it("growing copies the last line; one line for all copies set 1 back", () => {
    let s = withSlots(BENCH);
    s = setPerSet(s, 0, 0, true);
    s = updateLine(s, 0, 0, 2, { repsMin: 3 }, "LB");
    s = setTargetSets(s, 0, 0, 5, lineIds(5));
    expect(slotsOf(s)[0]!.sets.map((l) => l.repsMin)).toEqual([
      null,
      null,
      3,
      3,
      3,
    ]);
    s = updateLine(s, 0, 0, 0, { repsMin: 6 }, "LB");
    s = setPerSet(s, 0, 0, false);
    expect(slotsOf(s)[0]!.sets.map((l) => l.repsMin)).toEqual([6, 6, 6, 6, 6]);
    s = setTargetSets(s, 0, 0, 2, lineIds(2));
    expect(slotsOf(s)[0]!.targetSets).toBe(2);
    expect(slotsOf(s)[0]!.sets).toHaveLength(2);
  });
});

describe("supersets", () => {
  it("superset with next groups two slots, labelled A1/A2 in order", () => {
    let s = withSlots(BENCH, ROW, SQUAT, CURL);
    s = supersetWithNext(s, 0, 0);
    s = supersetWithNext(s, 0, 2);
    const labels = groupLabels(slotsOf(s));
    expect(slotsOf(s).map((x) => labels.get(x.id))).toEqual([
      "A1",
      "A2",
      "B1",
      "B2",
    ]);
    // Keys are sent 1, 2 by first appearance.
    expect(
      toCycleTree(s).workouts[0]!.plannedExercises!.map((x) => x.groupKey),
    ).toEqual([1, 1, 2, 2]);
  });

  it("a third slot joins; ungrouping the middle splits the group", () => {
    let s = withSlots(BENCH, ROW, SQUAT);
    s = supersetWithNext(s, 0, 0);
    s = supersetWithNext(s, 0, 1);
    let labels = groupLabels(slotsOf(s));
    expect(slotsOf(s).map((x) => labels.get(x.id))).toEqual(["A1", "A2", "A3"]);
    s = ungroup(s, 0, 1);
    labels = groupLabels(slotsOf(s));
    // Two lone slots either side: neither is a superset any more.
    expect(slotsOf(s).map((x) => labels.get(x.id))).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("moving a slot out of its group ends a group of two", () => {
    let s = withSlots(BENCH, ROW, SQUAT);
    s = supersetWithNext(s, 0, 0);
    s = moveSlot(s, 0, 0, 2);
    expect(slotsOf(s).map((x) => x.groupKey)).toEqual([null, null, null]);
    s = supersetWithNext(s, 0, 0);
    s = removeSlot(s, 0, 1);
    expect(slotsOf(s).map((x) => x.groupKey)).toEqual([null, null]);
  });
});

describe("a stored cycle", () => {
  it("round-trips unchanged: ids, positions with gaps, freeform sets", () => {
    const detail = storedCycle();
    const state = load(detail);
    const tree = cycleTree.parse(toCycleTree(state));
    const stored = detail.cycle.workouts.map(storedNode);
    expect(tree.workouts).toEqual(stored);
    // Legs' squat: four target sets, three prescribed, so per set.
    expect(state.workouts[1]!.slots[0]!.perSet).toBe(true);
    expect(state.workouts[1]!.slots[0]!.sets).toHaveLength(4);
  });

  it("a trained workout is frozen: sent verbatim, never edited or moved", () => {
    const detail = storedCycle();
    let s = load(detail);
    const push = detail.cycle.workouts[0]!;
    s = renameWorkout(s, 0, "Chest");
    s = removeWorkout(s, 0);
    s = addSlot(s, 0, { exerciseId: ROW }, slotIds());
    expect(s.workouts[0]!.name).toBe("Push");
    expect(s.workouts[0]!.slots).toHaveLength(1);
    expect(canMoveWorkout(s.workouts, 0, 1)).toBe(false);
    // Legs can't move up across Push; it can trade places with Pull.
    expect(canMoveWorkout(s.workouts, 1, -1)).toBe(false);
    expect(canMoveWorkout(s.workouts, 1, 1)).toBe(true);
    expect(moveWorkout(s, 1, -1)).toBe(s);
    expect(toCycleTree(s).workouts[0]).toEqual(storedNode(push));
    // When it was logged is kept beside it, never sent back.
    expect(s.workouts[0]!.trainedAt).toBe("2026-10-20T13:00:00.000Z");
    expect(toCycleTree(s).workouts[0]).not.toHaveProperty("trainedAt");
    expect(toCycleTree(s).workouts[0]).not.toHaveProperty("trained");
  });

  it("reordering after a trained workout keeps its position fixed", () => {
    let s = load();
    s = moveWorkout(s, 1, 1);
    s = addWorkout(s, newId());
    const tree = cycleTree.parse(toCycleTree(s));
    expect(tree.workouts.map((w) => [w.name, w.position])).toEqual([
      ["Push", 0],
      ["Pull", 1],
      ["Legs", 2],
      ["Workout 4", 3],
    ]);
  });
});

describe("assignPositions", () => {
  it("keeps stored positions in order, renumbers when they aren't", () => {
    const item = (storedPosition: number | null, fixed = false) => ({
      storedPosition,
      fixed,
    });
    expect(assignPositions([item(0), item(3), item(7)])).toEqual([0, 3, 7]);
    expect(assignPositions([item(3), item(0)])).toEqual([0, 1]);
    expect(
      assignPositions([item(0, true), item(4), item(2), item(9, true)]),
    ).toEqual([0, 1, 2, 9]);
    expect(assignPositions([item(1), item(5, true), item(null)])).toEqual([
      1, 5, 6,
    ]);
  });
});

describe("a new program", () => {
  it("starts with one workout, and builds a valid tree", () => {
    let s = newProgram(newId);
    s = addSlot(s, 0, { placeholderLabel: "conditioning finisher" }, slotIds());
    s = addWorkout(s, newId());
    s = addSlot(s, 1, { exerciseId: SQUAT }, slotIds());
    s = updateLine(s, 1, 0, "all", { weight: 100 }, "KG");
    const tree = cycleTree.parse(toCycleTree(s));
    expect(tree.workouts.map((w) => [w.name, w.position])).toEqual([
      ["Workout 1", 0],
      ["Workout 2", 1],
    ]);
    expect(tree.workouts[0]!.plannedExercises[0]).toMatchObject({
      exerciseId: null,
      placeholderLabel: "conditioning finisher",
      targetSets: 3,
    });
    expect(
      tree.workouts[1]!.plannedExercises[0]!.plannedSets[0]!.weightUnit,
    ).toBe("KG");
  });
});

describe("rebase after a stale refusal", () => {
  it("keeps the lifter's edits, freezes what was trained since, takes the new baseline", () => {
    const detail = storedCycle();
    let s = load(detail);
    s = renameWorkout(s, 1, "Leg day");
    s = removeWorkout(s, 2);
    // Since the preview: Pull was trained elsewhere.
    const fresh = structuredClone(detail);
    fresh.cycle.workouts[2]!.trained = true;
    fresh.cycle.workouts[2]!.trainedAt = "2026-10-29T18:00:00.000Z";
    fresh.fingerprint = "b".repeat(64);
    const next = rebase(s, fresh);
    expect(next.workouts[2]!.trainedAt).toBe("2026-10-29T18:00:00.000Z");
    expect(next.baseline).toBe("b".repeat(64));
    expect(next.workouts.map((w) => [w.name, w.frozen !== null])).toEqual([
      ["Push", true],
      ["Leg day", false],
      ["Pull", true],
    ]);
  });
});
