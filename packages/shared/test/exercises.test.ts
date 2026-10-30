// The step-4a exercise catalog contracts: the list and its query, create,
// edit and notes. Valid payloads round-trip; refusals say why.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import {
  createExerciseRequest,
  editExerciseRequest,
  exerciseNotesRequest,
  exerciseResponse,
  exercisesResponse,
  listExercisesQuery,
  newId,
} from "../src/index";
import { messages } from "./fixtures";

describe("exercises", () => {
  const item = {
    id: randomUUID(),
    name: "Back Squat",
    isCustom: false,
    isActive: true,
    primaryMuscles: ["QUADS", "GLUTES"],
    secondaryMuscles: ["ADDUCTORS"],
    equipment: "BARBELL",
    metrics: [
      { metric: "REPS", isRequired: true },
      { metric: "WEIGHT", isRequired: true },
    ],
    setup: "pins at 4",
    cues: null,
  };

  it("round-trips the list and a single exercise", () => {
    const body = {
      exercises: [
        item,
        { ...item, id: newId(), isCustom: true, equipment: null },
      ],
      units: { default: "KG", overrides: { [item.id]: "LB" } },
    };
    assert.deepEqual(exercisesResponse.parse(body), body);
    assert.equal(
      exercisesResponse.safeParse({ exercises: [] }).success,
      false,
      "units are part of the catalog read",
    );
    assert.equal(
      exercisesResponse.safeParse({
        exercises: [],
        units: { default: "STONE", overrides: {} },
      }).success,
      false,
    );
    assert.deepEqual(exerciseResponse.parse({ exercise: item }), {
      exercise: item,
    });
  });

  it("reads includeRetired from the query string", () => {
    assert.deepEqual(listExercisesQuery.parse({}), { includeRetired: false });
    assert.deepEqual(listExercisesQuery.parse({ includeRetired: "1" }), {
      includeRetired: true,
    });
    assert.equal(
      listExercisesQuery.safeParse({ includeRetired: "yes" }).success,
      false,
    );
  });

  it("round-trips a create, defaulting muscles and equipment", () => {
    const body = {
      id: newId(),
      name: "Reverse Hyper",
      primaryMuscles: ["GLUTES"],
      secondaryMuscles: ["HAMSTRINGS", "LOWER_BACK"],
      equipment: "MACHINE",
      metrics: [
        { metric: "REPS", isRequired: true },
        { metric: "WEIGHT", isRequired: false },
      ],
    };
    assert.deepEqual(createExerciseRequest.parse(body), body);
    assert.deepEqual(
      createExerciseRequest.parse({
        id: body.id,
        name: " Reverse Hyper ",
        metrics: body.metrics,
      }),
      {
        id: body.id,
        name: "Reverse Hyper",
        primaryMuscles: [],
        secondaryMuscles: [],
        equipment: null,
        metrics: body.metrics,
      },
    );
  });

  it("refuses a create without metrics, with a repeated metric, or a non-v7 id", () => {
    const body = {
      id: newId(),
      name: "Reverse Hyper",
      metrics: [{ metric: "REPS", isRequired: true }],
    };
    assert.deepEqual(
      messages(createExerciseRequest, { ...body, metrics: [] }),
      ["Choose at least one thing to record, such as reps."],
    );
    assert.deepEqual(
      messages(createExerciseRequest, {
        ...body,
        metrics: [body.metrics[0], body.metrics[0]],
      }),
      ["A metric is listed twice."],
    );
    assert.equal(
      createExerciseRequest.safeParse({ ...body, id: randomUUID() }).success,
      false,
    );
    assert.equal(
      createExerciseRequest.safeParse({ ...body, name: "" }).success,
      false,
    );
  });

  it("refuses secondary muscles without a primary, and a muscle in both", () => {
    const body = {
      id: newId(),
      name: "Reverse Hyper",
      metrics: [{ metric: "REPS", isRequired: true }],
    };
    assert.deepEqual(
      messages(createExerciseRequest, {
        ...body,
        secondaryMuscles: ["GLUTES"],
      }),
      ["Choose a primary muscle before adding secondary muscles."],
    );
    assert.deepEqual(
      messages(createExerciseRequest, {
        ...body,
        primaryMuscles: ["GLUTES", "UPPER_BACK"],
        secondaryMuscles: ["UPPER_BACK"],
      }),
      ["A muscle can't be both primary and secondary: upper back."],
    );
  });

  it("edits name, muscles or equipment, and has no metrics field", () => {
    for (const body of [
      { name: "Reverse Hyperextension" },
      { primaryMuscles: ["GLUTES"], secondaryMuscles: [] },
      { equipment: null },
    ]) {
      assert.deepEqual(editExerciseRequest.parse(body), body);
    }
    assert.equal(
      editExerciseRequest.safeParse({
        name: "X",
        metrics: [{ metric: "REPS", isRequired: true }],
      }).success,
      false,
    );
    assert.deepEqual(messages(editExerciseRequest, {}), ["Nothing to change."]);
    assert.deepEqual(
      messages(editExerciseRequest, {
        primaryMuscles: [],
        secondaryMuscles: ["QUADS"],
      }),
      ["Choose a primary muscle before adding secondary muscles."],
    );
  });

  it("takes notes with a v7 id, storing blanks as null", () => {
    const body = { id: newId(), setup: "pins at 4", cues: null };
    assert.deepEqual(exerciseNotesRequest.parse(body), body);
    assert.deepEqual(exerciseNotesRequest.parse({ ...body, cues: "  " }), body);
    assert.equal(
      exerciseNotesRequest.safeParse({ ...body, id: randomUUID() }).success,
      false,
    );
  });
});
