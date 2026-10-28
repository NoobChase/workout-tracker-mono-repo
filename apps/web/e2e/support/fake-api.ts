import type { BrowserContext, Page, Route } from "@playwright/test";
import {
  editSetRequest,
  historyPageResponse,
  logSetRequest,
  sessionDetailResponse,
  startFromTemplateRequest,
  startWorkoutRequest,
  templatesResponse,
  whatsNextResponse,
  workoutContextResponse,
  type TemplateSummary,
  type WeightUnit,
} from "@workout-tracker/shared";

/*
 * The step 3 API, faked in memory behind `**\/api/**` (no Lambda, no Neon).
 * It applies writes the way `packages/services` does: client ids are
 * idempotency keys, a delete renumbers the survivors and drops an emptied
 * session exercise, a finish that resolves the last workout of an
 * open-ended program copies its highest cycle forward. Every response is
 * parsed with its `packages/shared` schema, so a fake that drifts from the
 * contract fails here rather than passing silently.
 */

const NAMES: Record<string, string> = {
  "01a170d4-dadd-708f-b947-8d2400bbbb5c": "Barbell Bench Press",
  "01a170d4-dade-72d2-92b5-df913b401dab": "Overhead Press",
  "01a170d4-dade-72d2-92b5-85f242049dd0": "Incline Dumbbell Bench Press",
  "01a170d4-dade-72d2-92b5-e86fa53199c1": "Dumbbell Lateral Raise",
  "01a170d4-dadf-731e-8dc9-50411e9f92c3": "Triceps Pushdown",
  "01a170d4-dade-72d2-92b5-a960023ee68a": "Barbell Row",
  "01a170d4-dade-72d2-92b5-c65fb0ce0df3": "Lat Pulldown",
  "01a170d4-dade-72d2-92b5-b43f0911b907": "Seated Cable Row",
  "01a170d4-dadf-731e-8dc9-2b0520f435e5": "Face Pull",
  "01a170d4-dadf-731e-8dc9-37b884ad1faa": "Dumbbell Curl",
  "01a170d4-dadf-731e-8dc9-5c1432d8b0f8": "Back Squat",
  "01a170d4-dadf-731e-8dc9-81b86a9d8042": "Romanian Deadlift",
  "01a170d4-dadf-731e-8dc9-6a1b064a2d1e": "Leg Press",
  "01a170d4-dadf-731e-8dc9-8fba1fe7ab30": "Lying Leg Curl",
  "01a170d4-dadf-731e-8dc9-a595a848b32c": "Standing Calf Raise",
  "01a170d4-dade-72d2-92b5-a0c39ca6b715": "Deadlift",
  "01a170d4-dadf-731e-8dc9-70941641495b": "Bulgarian Split Squat",
  "01a170d4-dadf-731e-8dc9-6374f93ae739": "Front Squat",
  "01a170d4-dadf-731e-8dc9-3bad852baf4e": "Hammer Curl",
};

const ID = Object.fromEntries(
  Object.entries(NAMES).map(([id, name]) => [name, id]),
) as Record<string, string>;

type Spec = [name: string, sets: number, min: number, max: number];

function template(
  slug: string,
  name: string,
  description: string,
  workouts: [string, Spec[]][],
): TemplateSummary {
  return {
    slug,
    name,
    description,
    workouts: workouts.map(([workoutName, exercises]) => ({
      name: workoutName,
      exercises: exercises.map(([exercise, targetSets, repsMin, repsMax]) => ({
        exerciseId: ID[exercise]!,
        name: exercise,
        targetSets,
        repsMin,
        repsMax,
      })),
    })),
  };
}

/** The real templates (`packages/db/src/templates.ts`), two of the three. */
export const TEMPLATES: TemplateSummary[] = [
  template(
    "push-pull-legs",
    "Push Pull Legs",
    "Three days: chest, shoulders and triceps; back and biceps; legs.",
    [
      [
        "Push",
        [
          ["Barbell Bench Press", 3, 5, 8],
          ["Overhead Press", 3, 6, 10],
          ["Incline Dumbbell Bench Press", 3, 8, 12],
          ["Dumbbell Lateral Raise", 3, 12, 15],
          ["Triceps Pushdown", 3, 10, 15],
        ],
      ],
      [
        "Pull",
        [
          ["Barbell Row", 3, 6, 10],
          ["Lat Pulldown", 3, 8, 12],
          ["Seated Cable Row", 3, 10, 12],
          ["Face Pull", 3, 12, 15],
          ["Dumbbell Curl", 3, 10, 12],
        ],
      ],
      [
        "Legs",
        [
          ["Back Squat", 3, 5, 8],
          ["Romanian Deadlift", 3, 8, 10],
          ["Leg Press", 3, 10, 12],
          ["Lying Leg Curl", 3, 10, 15],
          ["Standing Calf Raise", 3, 10, 15],
        ],
      ],
    ],
  ),
  template(
    "full-body-3-day",
    "Full Body 3-Day",
    "Three whole-body sessions a week, rotating A, B and C.",
    [
      [
        "Full Body A",
        [
          ["Back Squat", 3, 5, 8],
          ["Barbell Bench Press", 3, 5, 8],
          ["Barbell Row", 3, 6, 10],
          ["Dumbbell Lateral Raise", 2, 12, 15],
        ],
      ],
      [
        "Full Body B",
        [
          ["Deadlift", 3, 3, 5],
          ["Overhead Press", 3, 6, 10],
          ["Lat Pulldown", 3, 8, 12],
          ["Bulgarian Split Squat", 2, 8, 12],
        ],
      ],
      [
        "Full Body C",
        [
          ["Front Squat", 3, 6, 8],
          ["Incline Dumbbell Bench Press", 3, 8, 12],
          ["Seated Cable Row", 3, 10, 12],
          ["Hammer Curl", 2, 10, 12],
        ],
      ],
    ],
  ),
];

interface Planned {
  plannedExerciseId: string;
  exerciseId: string;
  position: number;
  targetSets: number;
  repsMin: number;
  repsMax: number;
}
interface Workout {
  id: string;
  programId: string;
  cycleNumber: number;
  position: number;
  name: string;
  exercises: Planned[];
}
interface Program {
  id: string;
  name: string;
}
interface Session {
  id: string;
  workoutId: string;
  performedAt: string;
  status: "IN_PROGRESS" | "COMPLETED";
}
interface SessionExercise {
  id: string;
  sessionId: string;
  exerciseId: string;
  plannedExerciseId: string | null;
  position: number;
}
interface StoredSet {
  id: string;
  sessionExerciseId: string;
  setNumber: number;
  reps: number;
  weight: number;
  weightUnit: WeightUnit;
}

export interface FakeApiOptions {
  units?: { default: WeightUnit; overrides: Record<string, WeightUnit> };
  historyPageSize?: number;
}

export class FakeApi {
  readonly programs: Program[] = [];
  readonly workouts: Workout[] = [];
  readonly sessions = new Map<string, Session>();
  readonly sessionExercises = new Map<string, SessionExercise>();
  readonly sets = new Map<string, StoredSet>();
  /** Every write that reached the server, in order: "PUT /api/sets/…". */
  readonly writes: string[] = [];
  /** Return a reason to reject a set write; the queue stops there. */
  rejectSet: ((body: unknown) => string | null) | null = null;
  /** The status a rejected set write gets: 422 invalid, 403 not entitled. */
  rejectStatus = 422;
  readonly units: {
    default: WeightUnit;
    overrides: Record<string, WeightUnit>;
  };
  readonly historyPageSize: number;

  constructor(options: FakeApiOptions = {}) {
    this.units = options.units ?? { default: "LB", overrides: {} };
    this.historyPageSize = options.historyPageSize ?? 20;
  }

  async install(target: Page | BrowserContext): Promise<void> {
    await target.route("**/api/**", (route) => this.#handle(route));
  }

  /** A program started from a template, as `POST /programs/from-template`. */
  startTemplate(
    slug: string,
    programId: string = crypto.randomUUID(),
  ): Program {
    const existing = this.programs.find((p) => p.id === programId);
    if (existing) return existing;
    const t = TEMPLATES.find((x) => x.slug === slug);
    if (!t) throw new Error(`No template ${slug}`);
    const taken = new Set(this.programs.map((p) => p.name));
    let name = t.name;
    for (let n = 2; taken.has(name); n++) name = `${t.name} (${n})`;
    const program = { id: programId, name };
    this.programs.push(program);
    t.workouts.forEach((w, position) =>
      this.workouts.push({
        id: crypto.randomUUID(),
        programId,
        cycleNumber: 1,
        position,
        name: w.name,
        exercises: w.exercises.map((e, i) => ({
          plannedExerciseId: crypto.randomUUID(),
          exerciseId: e.exerciseId,
          position: i,
          targetSets: e.targetSets,
          repsMin: e.repsMin,
          repsMax: e.repsMax,
        })),
      }),
    );
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
    const sessionId = crypto.randomUUID();
    this.sessions.set(sessionId, {
      id: sessionId,
      workoutId,
      performedAt,
      status: "IN_PROGRESS",
    });
    for (const planned of workout.exercises) {
      const logged = sets[NAMES[planned.exerciseId]!];
      if (!logged) continue;
      const seId = crypto.randomUUID();
      this.sessionExercises.set(seId, {
        id: seId,
        sessionId,
        exerciseId: planned.exerciseId,
        plannedExerciseId: planned.plannedExerciseId,
        position: planned.position,
      });
      logged.forEach(([weight, reps], i) => {
        const id = crypto.randomUUID();
        this.sets.set(id, {
          id,
          sessionExerciseId: seId,
          setNumber: i + 1,
          reps,
          weight,
          weightUnit: this.#unit(planned.exerciseId),
        });
      });
    }
    // Finished the way the API finishes: the last one of a cycle extends it.
    this.#finish(sessionId);
    return sessionId;
  }

  /** The program's workouts of one cycle, by name. */
  workout(name: string, cycleNumber = 1): Workout {
    const w = this.workouts.find(
      (x) => x.name === name && x.cycleNumber === cycleNumber,
    );
    if (!w) throw new Error(`No workout ${name} in cycle ${cycleNumber}`);
    return w;
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
      out[NAMES[se.exerciseId]!] = [...this.sets.values()]
        .filter((s) => s.sessionExerciseId === se.id)
        .sort((a, b) => a.setNumber - b.setNumber)
        .map((s) => [s.setNumber, s.weight, s.weightUnit, s.reps]);
    }
    return out;
  }

  #unit(exerciseId: string): WeightUnit {
    return this.units.overrides[exerciseId] ?? this.units.default;
  }

  #resolved(workoutId: string): boolean {
    return [...this.sessions.values()].some(
      (s) => s.workoutId === workoutId && s.status === "COMPLETED",
    );
  }

  #next() {
    const next = this.programs.flatMap((program) => {
      const w = this.workouts
        .filter((x) => x.programId === program.id)
        .sort(
          (a, b) => a.cycleNumber - b.cycleNumber || a.position - b.position,
        )
        .find((x) => !this.#resolved(x.id));
      return w
        ? [
            {
              programId: program.id,
              programName: program.name,
              workoutId: w.id,
              workoutName: w.name,
              cycleNumber: w.cycleNumber,
            },
          ]
        : [];
    });
    const inProgress = [...this.sessions.values()]
      .filter((s) => s.status === "IN_PROGRESS")
      .map((s) => {
        const w = this.workouts.find((x) => x.id === s.workoutId)!;
        return {
          sessionId: s.id,
          workoutId: w.id,
          workoutName: w.name,
          programName: this.programs.find((p) => p.id === w.programId)!.name,
          performedAt: s.performedAt,
        };
      });
    return whatsNextResponse.parse({ next, inProgress });
  }

  #context(workoutId: string) {
    const w = this.workouts.find((x) => x.id === workoutId);
    if (!w) return null;
    const program = this.programs.find((p) => p.id === w.programId)!;
    const completed = [...this.sessions.values()]
      .filter((s) => s.status === "COMPLETED")
      .sort((a, b) => b.performedAt.localeCompare(a.performedAt));
    return workoutContextResponse.parse({
      workout: {
        id: w.id,
        name: w.name,
        position: w.position,
        cycleNumber: w.cycleNumber,
        programId: program.id,
        programName: program.name,
      },
      units: this.units,
      exercises: w.exercises.map((e) => {
        let lastTime = null;
        for (const s of completed) {
          const se = [...this.sessionExercises.values()].find(
            (x) => x.sessionId === s.id && x.exerciseId === e.exerciseId,
          );
          const sets = se
            ? [...this.sets.values()]
                .filter((x) => x.sessionExerciseId === se.id)
                .sort((a, b) => a.setNumber - b.setNumber)
            : [];
          if (sets.length > 0) {
            lastTime = {
              sessionId: s.id,
              performedAt: s.performedAt,
              sets: sets.map((x) => ({
                setNumber: x.setNumber,
                reps: x.reps,
                weight: x.weight,
                weightUnit: x.weightUnit,
              })),
            };
            break;
          }
        }
        return {
          plannedExerciseId: e.plannedExerciseId,
          position: e.position,
          exerciseId: e.exerciseId,
          name: NAMES[e.exerciseId]!,
          metrics: ["weight", "reps"],
          targetSets: e.targetSets,
          plannedSets: Array.from({ length: e.targetSets }, (_, i) => ({
            setNumber: i + 1,
            repsMin: e.repsMin,
            repsMax: e.repsMax,
            weight: null,
            weightUnit: null,
          })),
          lastTime,
        };
      }),
    });
  }

  #finish(sessionId: string) {
    const session = this.sessions.get(sessionId)!;
    if (session.status === "COMPLETED") return false;
    session.status = "COMPLETED";
    const w = this.workouts.find((x) => x.id === session.workoutId)!;
    const all = this.workouts.filter((x) => x.programId === w.programId);
    if (!all.every((x) => this.#resolved(x.id))) return false;
    const top = Math.max(...all.map((x) => x.cycleNumber));
    for (const x of all.filter((y) => y.cycleNumber === top)) {
      this.workouts.push({
        ...x,
        id: crypto.randomUUID(),
        cycleNumber: top + 1,
        exercises: x.exercises.map((e) => ({
          ...e,
          plannedExerciseId: crypto.randomUUID(),
        })),
      });
    }
    return true;
  }

  #detail(sessionId: string) {
    const s = this.sessions.get(sessionId);
    if (!s) return null;
    const w = this.workouts.find((x) => x.id === s.workoutId)!;
    return sessionDetailResponse.parse({
      session: {
        id: s.id,
        workoutId: w.id,
        workoutName: w.name,
        programName: this.programs.find((p) => p.id === w.programId)!.name,
        cycleNumber: w.cycleNumber,
        performedAt: s.performedAt,
        status: s.status,
      },
      exercises: w.exercises.map((e) => {
        const se = [...this.sessionExercises.values()].find(
          (x) =>
            x.sessionId === s.id && x.plannedExerciseId === e.plannedExerciseId,
        );
        return {
          position: e.position,
          sessionExerciseId: se?.id ?? null,
          exerciseId: e.exerciseId,
          name: NAMES[e.exerciseId]!,
          plannedExerciseId: e.plannedExerciseId,
          skipped: !se,
          sets: se
            ? [...this.sets.values()]
                .filter((x) => x.sessionExerciseId === se.id)
                .sort((a, b) => a.setNumber - b.setNumber)
                .map((x) => ({
                  id: x.id,
                  setNumber: x.setNumber,
                  reps: x.reps,
                  weight: x.weight,
                  weightUnit: x.weightUnit,
                  kind: "NORMAL",
                }))
            : [],
        };
      }),
    });
  }

  #history(cursor: string | null) {
    const done = [...this.sessions.values()]
      .filter((s) => s.status === "COMPLETED")
      .sort((a, b) => b.performedAt.localeCompare(a.performedAt));
    const start = cursor ? Number(cursor) : 0;
    const page = done.slice(start, start + this.historyPageSize);
    const end = start + page.length;
    return historyPageResponse.parse({
      items: page.map((s) => {
        const w = this.workouts.find((x) => x.id === s.workoutId)!;
        const ses = new Set(
          [...this.sessionExercises.values()]
            .filter((x) => x.sessionId === s.id)
            .map((x) => x.id),
        );
        return {
          sessionId: s.id,
          performedAt: s.performedAt,
          programName: this.programs.find((p) => p.id === w.programId)!.name,
          workoutName: w.name,
          cycleNumber: w.cycleNumber,
          countedSets: [...this.sets.values()].filter((x) =>
            ses.has(x.sessionExerciseId),
          ).length,
        };
      }),
      nextCursor: end < done.length ? String(end) : null,
    });
  }

  async #handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;
    const [, , resource, id, action] = path.split("/");
    const body: unknown = request.postData()
      ? JSON.parse(request.postData()!)
      : undefined;
    const json = (data: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    const fail = (status: number, error: string) =>
      json({ ok: false, error }, status);

    if (method !== "GET") this.writes.push(`${method} ${path}`);

    if (method === "GET" && path === "/api/next") return json(this.#next());
    if (method === "GET" && path === "/api/templates") {
      return json(templatesResponse.parse({ templates: TEMPLATES }));
    }
    if (method === "POST" && path === "/api/programs/from-template") {
      const req = startFromTemplateRequest.parse(body);
      const program = this.startTemplate(req.templateSlug, req.programId);
      return json(
        {
          program: {
            id: program.id,
            name: program.name,
            status: "ACTIVE",
            targetCycles: null,
          },
        },
        201,
      );
    }
    if (method === "GET" && resource === "workouts" && action === "context") {
      const context = this.#context(id!);
      return context ? json(context) : fail(404, "No such workout.");
    }
    if (resource === "sessions" && id) {
      if (method === "PUT") {
        const req = startWorkoutRequest.parse(body);
        if (!this.sessions.has(id)) {
          this.sessions.set(id, {
            id,
            workoutId: req.workoutId,
            performedAt: req.performedAt,
            status: "IN_PROGRESS",
          });
        }
        const s = this.sessions.get(id)!;
        return json(
          {
            id,
            workoutId: s.workoutId,
            status: s.status,
            performedAt: s.performedAt,
          },
          201,
        );
      }
      if (method === "POST" && action === "finish") {
        if (!this.sessions.has(id)) return fail(404, "No such session.");
        const extended = this.#finish(id);
        return json({ sessionId: id, status: "COMPLETED", extended });
      }
      if (method === "GET") {
        const detail = this.#detail(id);
        return detail ? json(detail) : fail(404, "No such session.");
      }
    }
    if (resource === "sets" && id) {
      if (method === "PUT") {
        const req = logSetRequest.parse(body);
        const reason = this.rejectSet?.(req) ?? null;
        if (reason) return fail(this.rejectStatus, reason);
        if (!this.sessions.has(req.sessionExercise.sessionId)) {
          return fail(404, "That workout session doesn't exist.");
        }
        if (!this.sessionExercises.has(req.sessionExercise.id)) {
          this.sessionExercises.set(req.sessionExercise.id, {
            ...req.sessionExercise,
          });
        }
        if (!this.sets.has(id)) {
          this.sets.set(id, {
            id,
            sessionExerciseId: req.sessionExercise.id,
            setNumber: req.setNumber,
            reps: req.reps,
            weight: req.weight,
            weightUnit:
              req.weightUnit ?? this.#unit(req.sessionExercise.exerciseId),
          });
        }
        return json(
          { ...this.sets.get(id), kind: "NORMAL", loggedAt: req.loggedAt },
          201,
        );
      }
      if (method === "PATCH") {
        const req = editSetRequest.parse(body);
        const set = this.sets.get(id);
        if (!set) return fail(404, "That set doesn't exist.");
        set.reps = req.reps;
        set.weight = req.weight;
        return json({
          ...set,
          kind: "NORMAL",
          loggedAt: new Date().toISOString(),
        });
      }
      if (method === "DELETE") {
        const set = this.sets.get(id);
        if (set) {
          this.sets.delete(id);
          const survivors = [...this.sets.values()]
            .filter((s) => s.sessionExerciseId === set.sessionExerciseId)
            .sort((a, b) => a.setNumber - b.setNumber);
          survivors.forEach((s, i) => (s.setNumber = i + 1));
          if (survivors.length === 0) {
            this.sessionExercises.delete(set.sessionExerciseId);
          }
        }
        return route.fulfill({ status: 204 });
      }
    }
    if (method === "GET" && path === "/api/history") {
      return json(this.#history(url.searchParams.get("cursor")));
    }
    return fail(404, `fake: unhandled ${method} ${path}`);
  }
}

export { ID as EXERCISE_IDS };
