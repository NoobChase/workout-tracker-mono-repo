import { describe, expect, it } from "vitest";
import { cycleFixture } from "../test/fakes.js";
import {
  buildOutline,
  cyclesToFetch,
  deviceNext,
  successorOf,
  type NextItem,
  type ProgramOutline,
} from "./outline.js";

/*
 * The device's what's-next rule (design D15 of step-4a): a workout finished
 * or skipped here is resolved, and home moves to the program's following
 * workout without waiting for the server.
 */

function outline(
  id: string,
  targetCycles: number | null,
  cycles: Record<number, string[]>,
): ProgramOutline {
  return {
    programId: id,
    programName: id.toUpperCase(),
    targetCycles,
    workouts: Object.entries(cycles).flatMap(([n, names]) =>
      names.map((name, position) => ({
        workoutId: `${id}-${n}-${name}`,
        name,
        cycleNumber: Number(n),
        position,
        trained: false,
      })),
    ),
  };
}

const ppl = outline("ppl", null, { 3: ["Push", "Pull", "Legs"] });
const fixed = outline("fixed", 12, {
  4: ["Upper", "Lower"],
  5: ["Upper", "Lower"],
});
const last = outline("last", 12, { 12: ["Upper", "Lower"] });

function item(o: ProgramOutline, workoutId: string): NextItem {
  const w = o.workouts.find((x) => x.workoutId === workoutId)!;
  return {
    programId: o.programId,
    programName: o.programName,
    workoutId,
    workoutName: w.name,
    cycleNumber: w.cycleNumber,
  };
}

describe("successorOf", () => {
  it("names the next workout in the same cycle", () => {
    expect(successorOf([ppl], "ppl-3-Push", new Set())).toEqual({
      kind: "workout",
      item: item(ppl, "ppl-3-Pull"),
    });
  });

  it("passes workouts already resolved on this device", () => {
    expect(successorOf([ppl], "ppl-3-Push", new Set(["ppl-3-Pull"]))).toEqual({
      kind: "workout",
      item: item(ppl, "ppl-3-Legs"),
    });
  });

  it("crosses into a fixed program's next cycle when it was fetched", () => {
    expect(successorOf([fixed], "fixed-4-Lower", new Set())).toEqual({
      kind: "workout",
      item: item(fixed, "fixed-5-Upper"),
    });
  });

  it("rolls an open-ended program over: the new cycle repeats the first workout", () => {
    expect(successorOf([ppl], "ppl-3-Legs", new Set())).toEqual({
      kind: "new-cycle",
      programId: "ppl",
      programName: "PPL",
      cycleNumber: 4,
      workoutName: "Push",
    });
  });

  it("completes a fixed program on its last workout", () => {
    expect(successorOf([last], "last-12-Lower", new Set())).toEqual({
      kind: "complete",
      programId: "last",
      programName: "LAST",
    });
  });

  it("is unknown past the cycles fetched, or for a workout not in any outline", () => {
    expect(successorOf([fixed], "fixed-5-Lower", new Set())).toEqual({
      kind: "unknown",
      programId: "fixed",
      programName: "FIXED",
    });
    expect(successorOf([fixed], "elsewhere", new Set())).toEqual({
      kind: "unknown",
      programId: null,
      programName: null,
    });
  });
});

describe("workouts the server already has a session for", () => {
  // Push is next; Pull was skipped on another device (or started there).
  const read = cycleFixture(3, [
    { id: "Push", name: "Push" },
    { id: "Pull", name: "Pull" },
    { id: "Legs", name: "Legs" },
  ]);
  read.cycle.workouts[1]!.trained = true;
  const built = buildOutline({ id: "ppl", name: "PPL", targetCycles: null }, [
    read,
  ]);

  it("keeps the cycle read's trained flag in the outline", () => {
    expect(built.workouts.map((w) => [w.name, w.trained])).toEqual([
      ["Push", false],
      ["Pull", true],
      ["Legs", false],
    ]);
  });

  it("are never the successor: a skip or Finish & start next passes them", () => {
    const after = successorOf([built], "Push", new Set());
    expect(after).toMatchObject({
      kind: "workout",
      item: { workoutId: "Legs" },
    });
    expect(
      deviceNext([{ ...item(built, "Push") }], [built], new Set(["Push"])),
    ).toMatchObject({ next: [{ workoutId: "Legs" }], waiting: [] });
  });

  it("still locate a trained workout, so one in progress has a successor", () => {
    expect(successorOf([built], "Pull", new Set())).toMatchObject({
      kind: "workout",
      item: { workoutId: "Legs" },
    });
  });

  it("roll an open-ended program over when every later workout is trained", () => {
    const allDone = buildOutline(
      { id: "ppl", name: "PPL", targetCycles: null },
      [
        {
          ...read,
          cycle: {
            ...read.cycle,
            workouts: read.cycle.workouts.map((w, i) => ({
              ...w,
              trained: i > 0,
            })),
          },
        },
      ],
    );
    expect(successorOf([allDone], "Push", new Set())).toMatchObject({
      kind: "new-cycle",
      cycleNumber: 4,
    });
  });
});

describe("deviceNext", () => {
  const next = [item(ppl, "ppl-3-Push"), item(fixed, "fixed-4-Upper")];

  it("keeps the server's next when nothing was resolved here", () => {
    expect(deviceNext(next, [ppl, fixed], new Set())).toEqual({
      next,
      waiting: [],
    });
  });

  it("moves a program past a workout skipped here, and past two in a row", () => {
    expect(
      deviceNext(next, [ppl, fixed], new Set(["ppl-3-Push"])).next,
    ).toEqual([item(ppl, "ppl-3-Pull"), item(fixed, "fixed-4-Upper")]);
    expect(
      deviceNext(next, [ppl, fixed], new Set(["ppl-3-Push", "ppl-3-Pull"]))
        .next,
    ).toEqual([item(ppl, "ppl-3-Legs"), item(fixed, "fixed-4-Upper")]);
  });

  it("keeps the server's program name, which may be newer than the outline's", () => {
    const renamed = [{ ...item(ppl, "ppl-3-Push"), programName: "Winter" }];
    expect(
      deviceNext(renamed, [ppl], new Set(["ppl-3-Push"])).next[0]?.programName,
    ).toBe("Winter");
  });

  it("waits for the server when the following workout is a cycle it will mint", () => {
    const resolved = new Set(["ppl-3-Push", "ppl-3-Pull", "ppl-3-Legs"]);
    const result = deviceNext(next, [ppl, fixed], resolved);
    expect(result.next).toEqual([item(fixed, "fixed-4-Upper")]);
    expect(result.waiting).toEqual([
      {
        kind: "new-cycle",
        programId: "ppl",
        programName: "PPL",
        cycleNumber: 4,
        workoutName: "Push",
      },
    ]);
  });

  it("drops a program whose next was resolved here and has no outline", () => {
    const result = deviceNext(next, [fixed], new Set(["ppl-3-Push"]));
    expect(result.next).toEqual([item(fixed, "fixed-4-Upper")]);
    expect(result.waiting).toEqual([
      { kind: "unknown", programId: "ppl", programName: "PPL" },
    ]);
  });
});

describe("cyclesToFetch", () => {
  const at = (cycleNumber: number) => ({
    ...item(ppl, "ppl-3-Push"),
    cycleNumber,
  });

  it("fetches the next cycle too only when a fixed program has one", () => {
    expect(cyclesToFetch(at(3), { targetCycles: null })).toEqual([3]);
    expect(cyclesToFetch(at(3), { targetCycles: 12 })).toEqual([3, 4]);
    expect(cyclesToFetch(at(12), { targetCycles: 12 })).toEqual([12]);
    expect(cyclesToFetch(at(3), undefined)).toEqual([3]);
  });
});
