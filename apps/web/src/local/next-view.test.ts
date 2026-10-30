import { newId } from "@workout-tracker/shared";
import { describe, expect, it } from "vitest";
import { contextFor, ids, nextFixture, USER } from "../test/fakes.js";
import { buildNextView, type NextInputs } from "./next-view.js";
import type { LocalSession } from "./sessions.js";

function record(over: Partial<LocalSession> = {}): LocalSession {
  return {
    sessionId: newId(),
    userId: USER,
    workoutId: ids.workout,
    performedAt: "2026-10-26T09:00:00.000Z",
    status: "IN_PROGRESS",
    finishedAt: null,
    context: contextFor(),
    exercises: [],
    ...over,
  };
}

const none: NextInputs = {
  server: null,
  device: null,
  outlines: [],
  records: new Map(),
  userId: USER,
  settled: new Map(),
};

describe("buildNextView", () => {
  it("counts progress over the slots the logger can take, from the device's record", () => {
    const context = contextFor();
    context.exercises.push({
      plannedExerciseId: newId(),
      position: 2,
      exerciseId: null,
      name: null,
      placeholderLabel: "conditioning finisher",
      metrics: [],
      targetSets: 1,
      plannedSets: [],
      lastTime: null,
    });
    const r = record({
      context,
      exercises: [
        {
          id: newId(),
          plannedExerciseId: ids.bench.planned,
          exerciseId: ids.bench.exercise,
          position: 0,
          sets: [
            {
              id: newId(),
              setNumber: 1,
              reps: 5,
              weight: 225,
              weightUnit: "LB",
              loggedAt: "2026-10-26T09:05:00.000Z",
            },
          ],
        },
      ],
    });
    const view = buildNextView({
      ...none,
      records: new Map([[r.sessionId, r]]),
    });
    expect(view.inProgress).toMatchObject([
      {
        sessionId: r.sessionId,
        onDevice: true,
        progress: { logged: 1, planned: 2 },
      },
    ]);
  });

  it("a session started elsewhere has no progress here", () => {
    const sessionId = newId();
    const view = buildNextView({
      ...none,
      server: {
        response: {
          next: [],
          inProgress: [
            {
              sessionId,
              workoutId: ids.workout,
              workoutName: "Push A",
              programName: "Push Pull Legs",
              performedAt: "2026-10-26T09:00:00.000Z",
            },
          ],
        },
        settledThrough: 0,
      },
    });
    expect(view.inProgress).toMatchObject([
      { sessionId, onDevice: false, progress: null },
    ]);
  });

  it("a delivered finish stays resolved until a server read that began after it", () => {
    const settled = new Map([[ids.workout, 3]]);
    const read = (settledThrough: number) =>
      buildNextView({
        ...none,
        server: { response: nextFixture, settledThrough },
        settled,
      }).next.map((n) => n.workoutId);
    // The read began before the settle: it may predate it.
    expect(read(2)).toEqual([]);
    // It began after: the server's answer stands.
    expect(read(3)).toEqual([ids.workout]);
    // No server read at all: the device's snapshot is older still.
    expect(
      buildNextView({ ...none, device: nextFixture, settled }).next,
    ).toEqual([]);
  });
});
