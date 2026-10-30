import {
  applyPreviewResponse,
  copyProgramRequest,
  createProgramRequest,
  cycleDetailResponse,
  extendProgramRequest,
  newId,
  programDetailResponse,
  programLimits,
  programListResponse,
  programResponse,
  renameProgramRequest,
  saveCycleRequest,
  saveCycleResponse,
  type CycleTree,
  type ExerciseListItem,
  type WeightUnit,
  type WorkoutNode,
} from "@workout-tracker/shared";
// The services' own normalizer (pure; Node only, which the fake is), so a
// fingerprint here is the one the API would compute.
import {
  canonicalJson,
  cycleContentKey,
  cycleFingerprint,
} from "@workout-tracker/db/fingerprint";
import {
  fail,
  ok,
  standardExercises,
  type Answer,
  type FakeUnits,
  type Plan,
  type Program,
  type Session,
  type SessionExercise,
  type StoredSet,
  type Workout,
} from "./fixtures.js";

/*
 * The fake API's tables and the plan side of `packages/services`: programs,
 * their cycles and workouts, and the rules every route shares (what's
 * trained, a program's progress, clones, rolling an open-ended program over
 * or completing a fixed one). `programRoutes` answers operations.md
 * 3.1-3.14: create, the cycle read and save (diff by id, the trained-workout
 * freeze, the stale guard), the apply preview, copy, extend, activate,
 * archive and rename, with the services' replay rules and words.
 */

const STALE = "This program changed after you opened it. Reload and try again.";
const PROGRAM_ID_TAKEN = "That program id is already in use.";
const DIFFERENT_REPLAY =
  "A different program was already created with this id. Reload and try again.";

/**
 * `programNameMatches` in "free" mode: the requested name itself, or a
 * "name (n)" the services could have picked for it.
 */
function freeNameMatches(stored: string, requested: string): boolean {
  if (stored === requested) return true;
  const prefix = `${requested} (`;
  if (!stored.startsWith(prefix) || !stored.endsWith(")")) return false;
  const n = stored.slice(prefix.length, -1);
  return /^[1-9][0-9]*$/.test(n) && Number(n) >= 2;
}

export class FakeTables {
  /** The catalog this user sees: standard exercises, then their own. */
  readonly exercises: Map<string, ExerciseListItem> = standardExercises();
  readonly programs: Program[] = [];
  readonly plans: Plan[] = [];
  readonly workouts: Workout[] = [];
  readonly sessions = new Map<string, Session>();
  readonly sessionExercises = new Map<string, SessionExercise>();
  readonly sets = new Map<string, StoredSet>();

  constructor(
    readonly units: FakeUnits,
    /** History's page size (`GET /history`). */
    readonly historyPageSize: number,
  ) {}

  /** The workouts of a program's cycle, in order. */
  cycleOf(programId: string, cycleNumber: number): Workout[] {
    return this.workoutsOf(programId).filter(
      (w) => w.cycleNumber === cycleNumber,
    );
  }

  /** A program's workouts in training order. */
  workoutsOf(programId: string): Workout[] {
    return this.workouts
      .filter((x) => x.programId === programId)
      .sort((a, b) => a.cycleNumber - b.cycleNumber || a.position - b.position);
  }

  plan(programId: string, cycleNumber: number): Plan | undefined {
    return this.plans.find(
      (p) => p.programId === programId && p.cycleNumber === cycleNumber,
    );
  }

  addCycle(programId: string, cycleNumber: number, id: string = newId()) {
    this.plans.push({ id, programId, cycleNumber });
  }

  resolved(workoutId: string): boolean {
    return [...this.sessions.values()].some(
      (s) =>
        s.workoutId === workoutId &&
        (s.status === "COMPLETED" || s.status === "SKIPPED"),
    );
  }

  /** A session of any status trains its workout (design D5). */
  trained(workoutId: string): boolean {
    return [...this.sessions.values()].some((s) => s.workoutId === workoutId);
  }

  /** The earliest `performedAt` of any session against the workout, or null. */
  trainedAt(workoutId: string): string | null {
    const times = [...this.sessions.values()]
      .filter((s) => s.workoutId === workoutId)
      .map((s) => s.performedAt)
      .sort();
    return times[0] ?? null;
  }

  unit(exerciseId: string): WeightUnit {
    return this.units.overrides[exerciseId] ?? this.units.default;
  }

  name(exerciseId: string): string {
    return this.exercises.get(exerciseId)?.name ?? "Unknown exercise";
  }

  /** A cycle's tree in the shared node shape (what the fingerprint reads). */
  tree(programId: string, cycleNumber: number): { workouts: WorkoutNode[] } {
    return {
      workouts: this.cycleOf(programId, cycleNumber).map((w) => ({
        id: w.id,
        name: w.name,
        position: w.position,
        notes: w.notes,
        plannedExercises: w.exercises.map((e) => ({
          id: e.plannedExerciseId,
          exerciseId: e.exerciseId,
          placeholderLabel: e.placeholderLabel,
          position: e.position,
          targetSets: e.targetSets,
          groupKey: e.groupKey,
          notes: e.notes,
          plannedSets: [...e.plannedSets].sort(
            (a, b) => a.setNumber - b.setNumber,
          ),
        })),
      })),
    };
  }

  /** The fingerprint of a stored cycle (`cycleFingerprint`). */
  fingerprint(programId: string, cycleNumber: number): string {
    return cycleFingerprint(this.tree(programId, cycleNumber));
  }

  summary(program: Program) {
    const open = this.workoutsOf(program.id).find((w) => !this.resolved(w.id));
    return {
      id: program.id,
      name: program.name,
      status: program.status,
      targetCycles: program.targetCycles,
      currentCycle: open?.cycleNumber ?? null,
    };
  }

  /** `freeProgramName`: the name, or the first free "name (n)" from 2. */
  freeName(base: string): string {
    const taken = new Set(this.programs.map((p) => p.name));
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) {
      if (!taken.has(`${base} (${n})`)) return `${base} (${n})`;
    }
  }

  /** Clones a cycle's workouts as cycle `to`, with fresh ids. */
  cloneCycle(
    fromProgram: string,
    fromCycle: number,
    toProgram: string,
    to: number,
    planId?: string,
  ) {
    this.addCycle(toProgram, to, planId);
    this.cloneWorkouts(fromProgram, fromCycle, toProgram, to);
  }

  cloneWorkouts(
    fromProgram: string,
    fromCycle: number,
    toProgram: string,
    to: number,
  ) {
    for (const x of this.cycleOf(fromProgram, fromCycle)) {
      this.workouts.push({
        ...x,
        id: newId(),
        programId: toProgram,
        cycleNumber: to,
        exercises: x.exercises.map((e) => ({
          ...e,
          plannedExerciseId: newId(),
          plannedSets: e.plannedSets.map((t) => ({ ...t, id: newId() })),
        })),
      });
    }
  }

  /** Drops a cycle's workouts. */
  dropWorkouts(programId: string, cycleNumber: number) {
    for (let i = this.workouts.length - 1; i >= 0; i--) {
      const w = this.workouts[i]!;
      if (w.programId === programId && w.cycleNumber === cycleNumber) {
        this.workouts.splice(i, 1);
      }
    }
  }

  /** Replaces a cycle's workouts with a request tree, keeping its ids. */
  writeCycle(programId: string, cycleNumber: number, tree: CycleTree) {
    this.dropWorkouts(programId, cycleNumber);
    for (const w of tree.workouts) {
      this.workouts.push({
        id: w.id,
        programId,
        cycleNumber,
        position: w.position,
        name: w.name,
        notes: w.notes,
        exercises: [...w.plannedExercises]
          .sort((a, b) => a.position - b.position)
          .map((x) => ({
            plannedExerciseId: x.id,
            exerciseId: x.exerciseId,
            placeholderLabel: x.placeholderLabel,
            position: x.position,
            targetSets: x.targetSets,
            groupKey: x.groupKey,
            notes: x.notes,
            plannedSets: x.plannedSets.map((t) => ({ ...t })),
          })),
      });
    }
  }

  /** `advanceProgram`: the exhaustion check, for an ACTIVE program only. */
  advance(programId: string): boolean {
    const program = this.programs.find((p) => p.id === programId)!;
    if (program.status !== "ACTIVE") return false;
    const all = this.workoutsOf(programId);
    if (!all.every((x) => this.resolved(x.id))) return false;
    if (program.targetCycles !== null) {
      program.status = "COMPLETED";
      return false;
    }
    const top = Math.max(...all.map((x) => x.cycleNumber));
    this.cloneCycle(programId, top, programId, top + 1);
    return true;
  }

  /** `finishSession`: COMPLETED, then the exhaustion check. */
  finish(sessionId: string): boolean {
    const session = this.sessions.get(sessionId)!;
    if (session.status === "COMPLETED") return false;
    session.status = "COMPLETED";
    const w = this.workouts.find((x) => x.id === session.workoutId)!;
    return this.advance(w.programId);
  }
}

/** The program routes (operations.md 3.1-3.14), or null if not one. */
export function programRoutes(
  t: FakeTables,
  method: string,
  parts: string[],
  body: unknown,
): Answer | null {
  const [, , resource, id, action, n, sub] = parts;
  if (resource !== "programs") return null;
  if (method === "POST" && !id) return create(t, body);
  if (method === "GET" && !id) {
    return ok(
      programListResponse.parse({
        programs: t.programs.map((p) => t.summary(p)),
      }),
    );
  }
  const program = t.programs.find((p) => p.id === id);
  if (!program) return fail(404, "That program doesn't exist.");
  const answer = (status = 200) =>
    ok(programResponse.parse({ program: t.summary(program) }), status);

  if (method === "GET" && !action) return detail(t, program);
  if (method === "GET" && action === "cycles" && n && sub === "apply-preview") {
    return preview(t, program.id, Number(n));
  }
  if (method === "GET" && action === "cycles" && n) {
    return cycle(t, program.id, Number(n));
  }
  if (method === "PUT" && action === "cycles" && n) {
    return save(t, program, Number(n), body);
  }
  if (method === "PATCH" && !action) {
    const req = renameProgramRequest.parse(body);
    const clash = t.programs.find(
      (p) => p.id !== program.id && p.name === req.name,
    );
    if (clash) {
      return fail(409, `You already have a program named "${clash.name}".`);
    }
    program.name = req.name;
    return answer();
  }
  if (method === "POST" && action === "copy") return copy(t, program, body);
  if (method === "POST" && action === "activate") {
    if (program.status === "COMPLETED") {
      return fail(
        400,
        `"${program.name}" is finished. Add a cycle to run it again.`,
      );
    }
    if (program.status !== "ACTIVE") {
      program.status = "ACTIVE";
      t.advance(program.id);
    }
    return answer();
  }
  if (method === "POST" && action === "archive") {
    program.status = "ARCHIVED";
    return answer();
  }
  if (method === "POST" && action === "extend") {
    const req = extendProgramRequest.parse(body);
    const replay = t.plans.find((p) => p.id === req.newPlanId);
    if (replay) {
      return replay.programId === program.id
        ? answer()
        : fail(409, "That cycle id is already in use.");
    }
    if (program.targetCycles === null) {
      return fail(
        400,
        `"${program.name}" is open-ended: it adds its next cycle by itself.`,
      );
    }
    if (program.targetCycles >= programLimits.maxExtendedCycles) {
      return fail(
        400,
        `"${program.name}" already runs ${program.targetCycles} cycles, the most a program can. Start a new program to keep going.`,
      );
    }
    const top = Math.max(...t.workoutsOf(program.id).map((w) => w.cycleNumber));
    t.cloneCycle(program.id, top, program.id, top + 1, req.newPlanId);
    program.targetCycles += 1;
    program.status = "ACTIVE";
    return answer();
  }
  return null;
}

/** `getProgram`: the program and each cycle's trained flags. */
function detail(t: FakeTables, program: Program): Answer {
  const cycles = t.plans
    .filter((p) => p.programId === program.id)
    .map((p) => p.cycleNumber)
    .sort((a, b) => a - b);
  return ok(
    programDetailResponse.parse({
      program: t.summary(program),
      cycles: cycles.map((c) => {
        const workouts = t.cycleOf(program.id, c);
        return {
          cycleNumber: c,
          trained: workouts.some((w) => t.trained(w.id)),
          fullyTrained:
            workouts.length > 0 && workouts.every((w) => t.trained(w.id)),
        };
      }),
    }),
  );
}

/** `getCycle`: the tree, each workout's trained flags, and its fingerprint. */
function cycle(t: FakeTables, programId: string, cycleNumber: number): Answer {
  const plan = t.plan(programId, cycleNumber);
  if (!plan) return fail(404, "That cycle doesn't exist.");
  return ok(
    cycleDetailResponse.parse({
      programId,
      cycleNumber,
      // Read with the tree, as the services do (D17): the builder's
      // `expected.source`, checked by `save`.
      fingerprint: t.fingerprint(programId, cycleNumber),
      cycle: {
        id: plan.id,
        workouts: t.tree(programId, cycleNumber).workouts.map((w) => ({
          ...w,
          trained: t.trained(w.id),
          trainedAt: t.trainedAt(w.id),
        })),
      },
    }),
  );
}

/** `createProgram` (operations.md 3.1; D3). */
function create(t: FakeTables, body: unknown): Answer {
  const req = createProgramRequest.parse(body);
  const existing = t.programs.find((p) => p.id === req.programId);
  if (existing) {
    // `isReplay`, "exact" names: the same name, length and cycle 1.
    if (
      existing.name !== req.name ||
      existing.targetCycles !== req.targetCycles
    ) {
      return fail(409, PROGRAM_ID_TAKEN);
    }
    if (t.fingerprint(existing.id, 1) !== cycleFingerprint(req.cycle)) {
      return fail(409, DIFFERENT_REPLAY);
    }
    return ok(programResponse.parse({ program: t.summary(existing) }), 201);
  }
  const clash = t.programs.find((p) => p.name === req.name);
  if (clash) {
    return fail(409, `You already have a program named "${clash.name}".`);
  }
  const unknown = req.cycle.workouts
    .flatMap((w) => w.plannedExercises)
    .find((x) => x.exerciseId !== null && !t.exercises.has(x.exerciseId));
  if (unknown) return fail(404, "That exercise doesn't exist.");
  const program: Program = {
    id: req.programId,
    name: req.name,
    status: "DRAFT",
    targetCycles: req.targetCycles,
  };
  t.programs.push(program);
  t.addCycle(program.id, 1, req.cycle.id);
  t.writeCycle(program.id, 1, req.cycle);
  for (let c = 2; c <= (req.targetCycles ?? 1); c++) {
    t.cloneCycle(program.id, 1, program.id, c);
  }
  return ok(programResponse.parse({ program: t.summary(program) }), 201);
}

/** `copyProgram` (operations.md 3.9; D17's replay rule, "free" names). */
function copy(t: FakeTables, source: Program, body: unknown): Answer {
  const req = copyProgramRequest.parse(body);
  if (req.newProgramId === source.id) return fail(409, PROGRAM_ID_TAKEN);
  if (!t.plan(source.id, 1)) {
    return fail(400, `"${source.name}" has no first cycle to copy.`);
  }
  const name = req.name ?? source.name;
  const replay = t.programs.find((p) => p.id === req.newProgramId);
  if (replay) {
    if (
      !freeNameMatches(replay.name, name) ||
      replay.targetCycles !== source.targetCycles
    ) {
      return fail(409, PROGRAM_ID_TAKEN);
    }
    if (t.fingerprint(replay.id, 1) !== t.fingerprint(source.id, 1)) {
      return fail(409, DIFFERENT_REPLAY);
    }
    return ok(programResponse.parse({ program: t.summary(replay) }), 201);
  }
  const copied: Program = {
    id: req.newProgramId,
    name: t.freeName(name),
    status: "DRAFT",
    targetCycles: source.targetCycles,
  };
  t.programs.push(copied);
  for (let c = 1; c <= (source.targetCycles ?? 1); c++) {
    t.cloneCycle(source.id, 1, copied.id, c);
  }
  return ok(programResponse.parse({ program: t.summary(copied) }), 201);
}

/** `getApplyPreview` (D7). */
function preview(t: FakeTables, programId: string, cycleNumber: number) {
  if (!t.plan(programId, cycleNumber)) {
    return fail(404, "That cycle doesn't exist.");
  }
  const source = t.fingerprint(programId, cycleNumber);
  const later = t.plans
    .filter((p) => p.programId === programId && p.cycleNumber > cycleNumber)
    .sort((a, b) => a.cycleNumber - b.cycleNumber)
    .map((p) => {
      const fingerprint = t.fingerprint(programId, p.cycleNumber);
      return {
        cycleNumber: p.cycleNumber,
        fingerprint,
        trained: t
          .cycleOf(programId, p.cycleNumber)
          .some((w) => t.trained(w.id)),
        matches: fingerprint === source,
      };
    });
  return ok(applyPreviewResponse.parse({ cycleNumber, source, later }));
}

/** Everything about a workout a trained session pins (`frozenView`). */
function frozenView(w: WorkoutNode) {
  return canonicalJson({
    name: w.name,
    position: w.position,
    notes: w.notes,
    plannedExercises: [...w.plannedExercises]
      .sort((a, b) => a.position - b.position)
      .map((s) => ({
        ...s,
        plannedSets: [...s.plannedSets].sort(
          (a, b) => a.setNumber - b.setNumber,
        ),
      })),
  });
}

/** `saveCycle` (operations.md 3.7, 3.8; D4, D5, D7). */
function save(
  t: FakeTables,
  program: Program,
  cycleNumber: number,
  body: unknown,
): Answer {
  const req = saveCycleRequest.parse(body);
  const plan = t.plan(program.id, cycleNumber);
  if (!plan) {
    return fail(404, `Cycle ${cycleNumber} doesn't exist in this program.`);
  }
  if (req.cycle.id !== plan.id) return fail(409, STALE);
  for (const { cycleNumber: k } of req.applyTo) {
    if (k <= cycleNumber || !t.plan(program.id, k)) return fail(409, STALE);
  }
  // The guard: everything as previewed, or the effect already in place
  // (fingerprint and every notes column), so a retry writes nothing.
  const stored = t.tree(program.id, cycleNumber);
  const desired = cycleContentKey(req.cycle);
  const targets = req.applyTo.map(({ cycleNumber: k, fingerprint }) => ({
    k,
    expected: fingerprint,
    tree: t.tree(program.id, k),
    trained: t.cycleOf(program.id, k).some((w) => t.trained(w.id)),
  }));
  const asPreviewed =
    cycleFingerprint(stored) === req.expected.source &&
    targets.every((x) => cycleFingerprint(x.tree) === x.expected && !x.trained);
  const alreadyDone =
    cycleContentKey(stored) === desired &&
    targets.every((x) => cycleContentKey(x.tree) === desired);
  if (!asPreviewed && !alreadyDone) return fail(409, STALE);

  // The freeze (D5): a trained workout comes back exactly as stored, and the
  // workouts before it may only shrink by removal.
  const storedIds = new Set(stored.workouts.map((w) => w.id));
  const desiredById = new Map(req.cycle.workouts.map((w) => [w.id, w]));
  for (const w of stored.workouts) {
    if (!t.trained(w.id)) continue;
    const d = desiredById.get(w.id);
    if (!d) {
      return fail(
        409,
        `${w.name} already has a logged session, so it can't be removed.`,
      );
    }
    if (frozenView(w) !== frozenView(d)) {
      return fail(
        409,
        `${w.name} already has a logged session, so it can't be changed or moved.`,
      );
    }
    const wasBefore = new Set(
      stored.workouts.filter((x) => x.position < w.position).map((x) => x.id),
    );
    for (const x of req.cycle.workouts) {
      const nowBefore = x.position < d.position;
      if (nowBefore && !wasBefore.has(x.id)) {
        return fail(
          409,
          storedIds.has(x.id)
            ? `${x.name} can't move before ${w.name}, which already has a logged session.`
            : `${x.name} can't go before ${w.name}, which already has a logged session.`,
        );
      }
      if (!nowBefore && wasBefore.has(x.id)) {
        return fail(
          409,
          `${x.name} can't move after ${w.name}, which already has a logged session.`,
        );
      }
    }
  }
  if (program.status === "COMPLETED") {
    const ids = new Set(
      stored.workouts.flatMap((w) => [
        w.id,
        ...w.plannedExercises.map((x) => x.id),
      ]),
    );
    const added = req.cycle.workouts.some(
      (w) => !ids.has(w.id) || w.plannedExercises.some((x) => !ids.has(x.id)),
    );
    if (added) {
      return fail(
        400,
        "This program is finished. Run another cycle to change it.",
      );
    }
  }
  t.writeCycle(program.id, cycleNumber, req.cycle);
  for (const x of targets) {
    if (cycleContentKey(x.tree) === desired) continue;
    t.dropWorkouts(program.id, x.k);
    t.cloneWorkouts(program.id, cycleNumber, program.id, x.k);
  }
  return ok(
    saveCycleResponse.parse({
      cycleNumber,
      applied: targets.map((x) => x.k).sort((a, b) => a - b),
    }),
  );
}
