import { newId } from "@workout-tracker/shared";
import { afterEach, describe, expect, it } from "vitest";
import {
  contextFor,
  ids,
  makeHarness,
  prefetch,
  type Harness,
} from "../test/fakes.js";
import { isLoggable, nameOf } from "./loggable.js";
import { LocalSessionError } from "./sessions.js";

let harnesses: Harness[] = [];
afterEach(() => {
  for (const h of harnesses) h.layer.close();
  harnesses = [];
});

const placeholder = newId();
const plank = { planned: newId(), exercise: newId() };

/** Push A with a placeholder and Plank (duration only) after the lifts. */
function withStopgapSlots() {
  const context = contextFor(ids.workout);
  context.exercises.push(
    {
      plannedExerciseId: placeholder,
      position: 2,
      exerciseId: null,
      name: null,
      placeholderLabel: "conditioning finisher",
      metrics: [],
      targetSets: 3,
      plannedSets: [],
      lastTime: null,
    },
    {
      plannedExerciseId: plank.planned,
      position: 3,
      exerciseId: plank.exercise,
      name: "Plank",
      metrics: ["DURATION"],
      targetSets: 3,
      plannedSets: [],
      lastTime: null,
    },
  );
  return context;
}

describe("the logger stopgap (step 4a D12)", () => {
  it("logs exactly reps and weight; placeholders and other metrics wait", () => {
    const [bench, , slot, timed] = withStopgapSlots().exercises;
    expect(isLoggable(bench!)).toBe(true);
    expect(isLoggable({ ...bench!, metrics: ["REPS", "WEIGHT"] })).toBe(true);
    expect(isLoggable({ ...bench!, metrics: ["REPS"] })).toBe(false);
    expect(isLoggable({ ...bench!, metrics: ["REPS", "WEIGHT", "RPE"] })).toBe(
      false,
    );
    expect(isLoggable(slot!)).toBe(false);
    expect(isLoggable(timed!)).toBe(false);
    expect(nameOf(slot!)).toBe("conditioning finisher");
    expect(nameOf(timed!)).toBe("Plank");
  });

  it("refuses a set on either slot, queues nothing, and the workout still finishes", async () => {
    const h = await makeHarness();
    harnesses.push(h);
    h.api.context = () => Promise.resolve(withStopgapSlots());
    await prefetch(h);
    h.connectivity.set(false);
    const sessionId = await h.layer.sessions.start(ids.workout);

    for (const plannedExerciseId of [placeholder, plank.planned]) {
      const attempt = h.layer.sessions.logSet(sessionId, {
        plannedExerciseId,
        reps: 5,
        weight: 0,
      });
      await expect(attempt).rejects.toBeInstanceOf(LocalSessionError);
      await expect(attempt).rejects.toMatchObject({ code: "not-loggable" });
    }
    await h.layer.sessions.finish(sessionId);
    expect(h.layer.queue.getState().items.map((i) => i.op)).toEqual([
      "start",
      "finish",
    ]);
    expect(h.layer.sessions.get(sessionId)!.exercises).toEqual([]);
  });
});
