import type { BrowserContext, Page, Route } from "@playwright/test";
import {
  newId,
  programResponse,
  startFromTemplateRequest,
  templatesResponse,
  type ExerciseListItem,
  type ProgramStatus,
} from "@workout-tracker/shared";
import { catalogRoutes } from "./catalog.js";
import {
  fail,
  ok,
  slotOf,
  TEMPLATES,
  UPPER_LOWER,
  type Answer,
  type FakeUnits,
  type Program,
  type Session,
  type Spec,
  type Workout,
  type WorkoutSpec,
} from "./fixtures.js";
import { FakeTables, programRoutes } from "./programs.js";
import { sessionRoutes, type SetRefusals } from "./sessions.js";

export { EXERCISE_IDS, TEMPLATES, UPPER_LOWER } from "./fixtures.js";
export type { SlotSpec, WorkoutSpec } from "./fixtures.js";

/*
 * The API, faked in memory behind `**\/api/**` (no Lambda, no Neon), for the
 * screen specs. It applies writes the way `packages/services` does: the
 * plan side in `programs.ts` (with the services' own cycle normalizer), the
 * training side in `sessions.ts`, the catalog in `catalog.ts`. Every
 * response is parsed with its `packages/shared` schema, so a fake that
 * drifts from the contract fails here rather than passing silently.
 *
 * Specs set a program up with `addProgram`, `startTemplate` and
 * `seedFinished`, read what was written from the tables and `writes`, and
 * turn the knobs below to lose answers or refuse writes.
 */

export interface FakeApiOptions {
  units?: FakeUnits;
  historyPageSize?: number;
}

export class FakeApi extends FakeTables implements SetRefusals {
  /** Every write that reached the server, in order: "PUT /api/sets/…". */
  readonly writes: string[] = [];
  /** The body of every write, in the same order. */
  readonly bodies: unknown[] = [];
  rejectSet: ((body: unknown) => string | null) | null = null;
  rejectStatus = 422;
  /** A lapsed account: every write is refused, as `requirePro` does. */
  lapsed = false;
  /**
   * Apply the next N writes, then drop their responses (the connection
   * failed on the way back), so a retry with the same ids can be checked.
   */
  loseResponses = 0;

  constructor(options: FakeApiOptions = {}) {
    super(
      options.units ?? { default: "LB", overrides: {} },
      options.historyPageSize ?? 20,
    );
  }

  async install(target: Page | BrowserContext): Promise<void> {
    await target.route("**/api/**", (route) => this.#handle(route));
  }

  // --- Setting a program up ----------------------------------------------------

  /** A program started from a template, as `POST /programs/from-template`. */
  startTemplate(slug: string, programId: string = newId()): Program {
    const existing = this.programs.find((p) => p.id === programId);
    if (existing) return existing;
    const t = TEMPLATES.find((x) => x.slug === slug);
    if (!t) throw new Error(`No template ${slug}`);
    return this.addProgram({
      id: programId,
      name: this.freeName(t.name),
      status: "ACTIVE",
      targetCycles: null,
      workouts: t.workouts.map((w) => [
        w.name,
        w.exercises.map(
          (e) => [e.name, e.targetSets, e.repsMin, e.repsMax] as Spec,
        ),
      ]),
    });
  }

  /**
   * A program in any state. A fixed program materializes all its cycles,
   * an open-ended one `cycles` (default 1). Every workout of the first
   * `resolvedThrough` cycles gets a COMPLETED session with no sets, so the
   * program is in its next cycle.
   */
  addProgram(spec: {
    name: string;
    status?: ProgramStatus;
    targetCycles?: number | null;
    workouts?: WorkoutSpec[];
    cycles?: number;
    resolvedThrough?: number;
    id?: string;
  }): Program {
    const program: Program = {
      id: spec.id ?? newId(),
      name: spec.name,
      status: spec.status ?? "ACTIVE",
      targetCycles: spec.targetCycles ?? null,
    };
    this.programs.push(program);
    const cycles = program.targetCycles ?? spec.cycles ?? 1;
    const workouts = spec.workouts ?? UPPER_LOWER;
    for (let n = 1; n <= cycles; n++) {
      this.addCycle(program.id, n);
      workouts.forEach(([name, exercises], position) =>
        this.workouts.push({
          id: newId(),
          programId: program.id,
          cycleNumber: n,
          position,
          name,
          notes: null,
          exercises: exercises.map((slot, i) =>
            slotOf(slot, i, (exercise) => this.exercise(exercise).id),
          ),
        }),
      );
    }
    let day = 1;
    for (const w of this.workoutsOf(program.id)) {
      if (w.cycleNumber > (spec.resolvedThrough ?? 0)) break;
      const id = newId();
      this.sessions.set(id, {
        id,
        workoutId: w.id,
        performedAt: new Date(Date.UTC(2026, 8, day++, 13)).toISOString(),
        status: "COMPLETED",
      });
    }
    return program;
  }

  /**
   * A finished session with sets, as if logged earlier: gives a workout
   * last-time numbers and puts an entry in history.
   */
  seedFinished(
    workoutId: string,
    performedAt: string,
    sets: Record<string, [weight: number, reps: number][]>,
  ): string {
    const workout = this.workouts.find((w) => w.id === workoutId)!;
    const sessionId = newId();
    this.sessions.set(sessionId, {
      id: sessionId,
      workoutId,
      performedAt,
      status: "IN_PROGRESS",
    });
    for (const planned of workout.exercises) {
      if (planned.exerciseId === null) continue;
      const logged = sets[this.name(planned.exerciseId)];
      if (!logged) continue;
      const seId = newId();
      this.sessionExercises.set(seId, {
        id: seId,
        sessionId,
        exerciseId: planned.exerciseId,
        plannedExerciseId: planned.plannedExerciseId,
        position: planned.position,
      });
      logged.forEach(([weight, reps], i) => {
        const id = newId();
        this.sets.set(id, {
          id,
          sessionExerciseId: seId,
          setNumber: i + 1,
          reps,
          weight,
          weightUnit: this.unit(planned.exerciseId!),
        });
      });
    }
    // Finished the way the API finishes: the last one of a cycle extends it.
    this.finish(sessionId);
    return sessionId;
  }

  /** A custom exercise, as if created earlier (operations.md 2.2). */
  addExercise(
    name: string,
    over: Partial<ExerciseListItem> = {},
  ): ExerciseListItem {
    const e: ExerciseListItem = {
      id: newId(),
      name,
      isCustom: true,
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
    this.exercises.set(e.id, e);
    return e;
  }

  // --- Reading what was written --------------------------------------------------

  /** A program by name. */
  program(name: string): Program {
    const p = this.programs.find((x) => x.name === name);
    if (!p) throw new Error(`No program ${name}`);
    return p;
  }

  /** A workout by name and cycle, in `programId` or the first program that has it. */
  workout(name: string, cycleNumber = 1, programId?: string): Workout {
    const w = this.workouts.find(
      (x) =>
        x.name === name &&
        x.cycleNumber === cycleNumber &&
        (programId === undefined || x.programId === programId),
    );
    if (!w) throw new Error(`No workout ${name} in cycle ${cycleNumber}`);
    return w;
  }

  /** An exercise by name. */
  exercise(name: string): ExerciseListItem {
    const e = [...this.exercises.values()].find((x) => x.name === name);
    if (!e) throw new Error(`No exercise ${name}`);
    return e;
  }

  /** The one session of a workout started through the app. */
  sessionOf(workoutId: string): Session | undefined {
    return [...this.sessions.values()].find((s) => s.workoutId === workoutId);
  }

  /** Sets of one session, per exercise name, in order: [setNumber, weight, unit, reps]. */
  setsOf(
    sessionId: string,
  ): Record<string, [number, number, string, number][]> {
    const out: Record<string, [number, number, string, number][]> = {};
    for (const se of this.sessionExercises.values()) {
      if (se.sessionId !== sessionId) continue;
      out[this.name(se.exerciseId)] = [...this.sets.values()]
        .filter((s) => s.sessionExerciseId === se.id)
        .sort((a, b) => a.setNumber - b.setNumber)
        .map((s) => [s.setNumber, s.weight, s.weightUnit, s.reps]);
    }
    return out;
  }

  // --- The wire ------------------------------------------------------------------

  /** The template routes (operations.md 3.13), or null if not one. */
  #templates(method: string, path: string, body: unknown): Answer | null {
    if (method === "GET" && path === "/api/templates") {
      return ok(templatesResponse.parse({ templates: TEMPLATES }));
    }
    if (method === "POST" && path === "/api/programs/from-template") {
      const req = startFromTemplateRequest.parse(body);
      const program = this.startTemplate(req.templateSlug, req.programId);
      return ok(programResponse.parse({ program: this.summary(program) }), 201);
    }
    return null;
  }

  async #handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;
    const parts = path.split("/");
    const posted = request.postData();
    const body: unknown = posted ? JSON.parse(posted) : undefined;
    const write = method !== "GET";

    let answer: Answer;
    if (write) {
      this.writes.push(`${method} ${path}`);
      this.bodies.push(body);
    }
    if (write && this.lapsed) {
      answer = fail(403, "pro subscription required");
    } else {
      answer =
        this.#templates(method, path, body) ??
        programRoutes(this, method, parts, body) ??
        catalogRoutes(this, method, url, parts, body) ??
        sessionRoutes(this, this, method, url, parts, body) ??
        fail(404, `fake: unhandled ${method} ${path}`);
    }

    if (answer.status === 204) return route.fulfill({ status: 204 });
    if (write && answer.status < 300 && this.loseResponses > 0) {
      // Applied, but the answer never arrives.
      this.loseResponses -= 1;
      return route.abort("connectionreset");
    }
    return route.fulfill({
      status: answer.status,
      contentType: "application/json",
      body: JSON.stringify(answer.data),
    });
  }
}
