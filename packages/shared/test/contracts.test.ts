// The wire contracts of step 3: valid payloads round-trip, and the cases the
// server must refuse (non-v7 client ids, bad numbers, bad units) are refused.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import {
  editSetRequest,
  finishWorkoutResponse,
  historyPageResponse,
  loggedSet,
  logSetRequest,
  newId,
  sessionDetailResponse,
  startFromTemplateRequest,
  startedSession,
  startFromTemplateResponse,
  startWorkoutRequest,
  templatesResponse,
  uuidV7,
  whatsNextResponse,
  workoutContextResponse,
} from "../src/index";

const NOW = "2026-10-26T12:00:00.000Z";

function validLogSet() {
  return {
    sessionExercise: {
      id: newId(),
      sessionId: newId(),
      exerciseId: randomUUID(),
      plannedExerciseId: newId(),
      position: 0,
    },
    setNumber: 1,
    reps: 8,
    weight: 135,
    weightUnit: "LB",
    loggedAt: NOW,
  };
}

function omit<T extends object, K extends keyof T>(obj: T, key: K): Omit<T, K> {
  const copy = { ...obj };
  delete copy[key];
  return copy;
}

describe("ids", () => {
  it("newId mints distinct UUIDv7 strings", () => {
    const a = newId();
    assert.equal(uuidV7.safeParse(a).success, true);
    assert.notEqual(a, newId());
  });

  it("uuidV7 rejects v4 and non-uuids", () => {
    assert.equal(uuidV7.safeParse(randomUUID()).success, false);
    assert.equal(uuidV7.safeParse("nope").success, false);
  });
});

describe("templates", () => {
  it("round-trips a template list", () => {
    const body = {
      templates: [
        {
          slug: "ppl",
          name: "Push Pull Legs",
          description: "Three days.",
          workouts: [
            {
              name: "Push",
              exercises: [
                {
                  exerciseId: randomUUID(),
                  name: "Bench Press",
                  targetSets: 3,
                  repsMin: 5,
                  repsMax: 8,
                },
              ],
            },
          ],
        },
      ],
    };
    assert.deepEqual(templatesResponse.parse(body), body);
  });

  it("start request needs a v7 program id", () => {
    const ok = { programId: newId(), templateSlug: "ppl" };
    assert.deepEqual(startFromTemplateRequest.parse(ok), ok);
    assert.equal(
      startFromTemplateRequest.safeParse({ ...ok, programId: randomUUID() })
        .success,
      false,
    );
  });

  it("start response has an open-ended program", () => {
    const body = {
      program: {
        id: newId(),
        name: "PPL",
        status: "ACTIVE",
        targetCycles: null,
      },
    };
    assert.deepEqual(startFromTemplateResponse.parse(body), body);
    assert.equal(
      startFromTemplateResponse.safeParse({
        program: { ...body.program, targetCycles: 4 },
      }).success,
      false,
    );
  });
});

describe("training", () => {
  it("round-trips what's next", () => {
    const body = {
      next: [
        {
          programId: newId(),
          programName: "PPL",
          workoutId: newId(),
          workoutName: "Push",
          cycleNumber: 1,
        },
      ],
      inProgress: [
        {
          sessionId: newId(),
          workoutId: newId(),
          workoutName: "Push",
          programName: "PPL",
          performedAt: NOW,
        },
      ],
    };
    assert.deepEqual(whatsNextResponse.parse(body), body);
  });

  it("round-trips a workout context, with and without last time", () => {
    const exerciseId = randomUUID();
    const body = {
      workout: {
        id: newId(),
        name: "Push",
        position: 0,
        cycleNumber: 1,
        programId: newId(),
        programName: "PPL",
      },
      units: { default: "LB", overrides: { [exerciseId]: "KG" } },
      exercises: [
        {
          plannedExerciseId: newId(),
          position: 0,
          exerciseId,
          name: "Bench Press",
          metrics: ["WEIGHT", "REPS"],
          targetSets: 3,
          plannedSets: [
            {
              setNumber: 1,
              repsMin: 5,
              repsMax: 8,
              weight: null,
              weightUnit: null,
            },
          ],
          lastTime: {
            sessionId: newId(),
            performedAt: NOW,
            sets: [{ setNumber: 1, reps: 5, weight: 225, weightUnit: "LB" }],
          },
        },
        {
          plannedExerciseId: newId(),
          position: 1,
          exerciseId: randomUUID(),
          name: "Curl",
          metrics: ["WEIGHT", "REPS"],
          targetSets: null,
          plannedSets: [],
          lastTime: null,
        },
      ],
    };
    assert.deepEqual(workoutContextResponse.parse(body), body);
  });

  it("round-trips start, log, edit and finish", () => {
    const start = { workoutId: newId(), performedAt: NOW };
    assert.deepEqual(startWorkoutRequest.parse(start), start);

    const log = validLogSet();
    assert.deepEqual(logSetRequest.parse(log), log);
    const noUnit = omit(log, "weightUnit");
    assert.deepEqual(logSetRequest.parse(noUnit), noUnit);
    const improvised = {
      ...log,
      sessionExercise: { ...log.sessionExercise, plannedExerciseId: null },
    };
    assert.deepEqual(logSetRequest.parse(improvised), improvised);

    const edit = { reps: 4, weight: 132.5, weightUnit: "KG" };
    assert.deepEqual(editSetRequest.parse(edit), edit);

    const fin = { sessionId: newId(), status: "COMPLETED", extended: false };
    assert.deepEqual(finishWorkoutResponse.parse(fin), fin);
    assert.equal(
      finishWorkoutResponse.safeParse({ ...fin, status: "IN_PROGRESS" })
        .success,
      false,
    );
  });

  it("round-trips the started session and the logged set", () => {
    const started = {
      id: newId(),
      workoutId: newId(),
      status: "IN_PROGRESS",
      performedAt: NOW,
    };
    assert.deepEqual(startedSession.parse(started), started);
    assert.equal(
      startedSession.safeParse({ ...started, status: "PAUSED" }).success,
      false,
    );

    const set = {
      id: newId(),
      sessionExerciseId: newId(),
      setNumber: 1,
      reps: 8,
      weight: 135.5,
      weightUnit: "LB",
      kind: "NORMAL",
      loggedAt: NOW,
    };
    assert.deepEqual(loggedSet.parse(set), set);
    const bare = { ...set, reps: null, weight: null, weightUnit: null };
    assert.deepEqual(loggedSet.parse(bare), bare);
    assert.equal(loggedSet.safeParse({ ...set, kind: "BONUS" }).success, false);
    assert.equal(loggedSet.safeParse(omit(set, "loggedAt")).success, false);
  });

  it("rejects non-v7 client ids", () => {
    const log = validLogSet();
    for (const field of ["id", "sessionId"] as const) {
      assert.equal(
        logSetRequest.safeParse({
          ...log,
          sessionExercise: { ...log.sessionExercise, [field]: randomUUID() },
        }).success,
        false,
        field,
      );
    }
  });

  it("rejects bad reps, setNumber, weight and unit", () => {
    const log = validLogSet();
    const bad: Record<string, unknown>[] = [
      { reps: -1 },
      { reps: 32768 },
      { reps: 1.5 },
      { setNumber: 0 },
      { weight: 100.123 },
      { weight: -5 },
      { weight: 100000 },
      { weightUnit: "STONE" },
    ];
    for (const patch of bad) {
      assert.equal(
        logSetRequest.safeParse({ ...log, ...patch }).success,
        false,
        JSON.stringify(patch),
      );
    }
    assert.equal(
      editSetRequest.safeParse({ reps: -1, weight: 1 }).success,
      false,
    );
    assert.equal(
      editSetRequest.safeParse({ reps: 1, weight: 1.005 }).success,
      false,
    );
    assert.equal(
      editSetRequest.safeParse({ reps: 1, weight: 1, weightUnit: "x" }).success,
      false,
    );
  });

  it("accepts boundary values", () => {
    const log = validLogSet();
    for (const patch of [
      { reps: 0, weight: 0 },
      { reps: 32767, weight: 99999.99 },
      { weight: 132.5 },
      { weight: 0.1 },
    ]) {
      assert.equal(
        logSetRequest.safeParse({ ...log, ...patch }).success,
        true,
        JSON.stringify(patch),
      );
    }
  });

  it("requires loggedAt, and a real datetime", () => {
    const missing = omit(validLogSet(), "loggedAt");
    assert.equal(logSetRequest.safeParse(missing).success, false);
    assert.equal(
      logSetRequest.safeParse({ ...validLogSet(), loggedAt: "yesterday" })
        .success,
      false,
    );
    assert.equal(
      startWorkoutRequest.safeParse({ workoutId: newId() }).success,
      false,
    );
  });

  it("requires reps and weight on a log", () => {
    const noReps = omit(validLogSet(), "reps");
    const noWeight = omit(validLogSet(), "weight");
    assert.equal(logSetRequest.safeParse(noReps).success, false);
    assert.equal(logSetRequest.safeParse(noWeight).success, false);
  });
});

describe("history", () => {
  it("round-trips a page, with and without a next cursor", () => {
    const item = {
      sessionId: newId(),
      performedAt: NOW,
      programName: "PPL",
      workoutName: "Push",
      cycleNumber: 1,
      countedSets: 5,
    };
    for (const nextCursor of [null, "abc"]) {
      const body = { items: [item], nextCursor };
      assert.deepEqual(historyPageResponse.parse(body), body);
    }
  });

  it("round-trips a session detail with a skipped exercise", () => {
    const body = {
      session: {
        id: newId(),
        workoutId: newId(),
        workoutName: "Push",
        programName: "PPL",
        cycleNumber: 1,
        performedAt: NOW,
        status: "COMPLETED",
      },
      exercises: [
        {
          position: 0,
          sessionExerciseId: newId(),
          exerciseId: randomUUID(),
          name: "Squat",
          plannedExerciseId: newId(),
          skipped: false,
          sets: [
            {
              id: newId(),
              setNumber: 1,
              reps: 5,
              weight: 225,
              weightUnit: "LB",
              kind: "NORMAL",
            },
            {
              id: newId(),
              setNumber: 2,
              reps: 5,
              weight: 185,
              weightUnit: "LB",
              kind: "DROP",
            },
          ],
        },
        {
          position: 1,
          exerciseId: randomUUID(),
          name: "Curl",
          sessionExerciseId: null,
          plannedExerciseId: null,
          skipped: true,
          sets: [],
        },
      ],
    };
    assert.deepEqual(sessionDetailResponse.parse(body), body);
    assert.equal(
      sessionDetailResponse.safeParse({
        ...body,
        exercises: [
          {
            ...body.exercises[0],
            sets: [{ ...body.exercises[0]!.sets[0], kind: "BOGUS" }],
          },
        ],
      }).success,
      false,
    );
  });
});
