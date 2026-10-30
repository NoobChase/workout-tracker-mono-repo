import {
  editSetRequest,
  logSetRequest,
  newId,
  skipWorkoutRequest,
  startWorkoutRequest,
  type SessionDetailResponse,
  type WeightUnit,
  type WorkoutContextResponse,
} from "@workout-tracker/shared";
import type { LocalDb } from "./db.js";
import type { ContextCache } from "./contexts.js";
import {
  addToQueue,
  type MutationQueue,
  type QueueItem,
  type QueueItemInput,
} from "./queue.js";
import { resolveUnit } from "./units.js";
import { isLoggable } from "./loggable.js";

/**
 * The in-progress workout's local record (design D8). The logger renders only
 * this, so it behaves the same online and offline. Every operation updates the
 * record and enqueues its wire request in one IndexedDB transaction: the two
 * commit together or not at all. The server never decides an id here; each
 * row the client creates carries a UUIDv7 from `newId()`, so a replay is a
 * no-op server-side. Sessions never touch the plan: the context is a copy.
 */

export interface LocalSet {
  id: string;
  setNumber: number;
  reps: number;
  weight: number;
  weightUnit: WeightUnit;
  /** The device's clock when the lifter logged it (design D5). */
  loggedAt: string;
}

export interface LocalSessionExercise {
  id: string;
  plannedExerciseId: string | null;
  exerciseId: string;
  position: number;
  sets: LocalSet[];
}

export interface LocalSession {
  sessionId: string;
  userId: string | null;
  workoutId: string;
  /** The device's clock when the lifter started (design D5). */
  performedAt: string;
  /**
   * SKIPPED: the whole workout was skipped before it started (operations.md
   * 4.14). It has no exercises, is never opened in the logger, and resolves
   * the workout on this device at once, like FINISHED.
   */
  status: "IN_PROGRESS" | "FINISHED" | "SKIPPED";
  /** When it was finished or skipped, on the device's clock. */
  finishedAt: string | null;
  /** The prefetched context as it was at the start (design D9). */
  context: WorkoutContextResponse;
  /** Only exercises with at least one set: skipped means no entry. */
  exercises: LocalSessionExercise[];
}

/** A local operation the lifter can't do; `message` is shown as written. */
export class LocalSessionError extends Error {
  constructor(
    readonly code:
      | "no-context"
      | "not-found"
      | "finished"
      | "unknown-exercise"
      | "unknown-set"
      | "not-loggable"
      | "not-signed-in"
      | "already-started"
      | "needs-connection",
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "LocalSessionError";
  }
}

export interface SessionStoreOptions {
  contexts: ContextCache;
  /**
   * The signed-in user, stamped on every record and queued write so another
   * account never sends them. `null` when no user is known: writes refuse.
   */
  userId: () => string | null;
  now?: () => Date;
}

type Change = { record: LocalSession; item: QueueItemInput | null };

/** Resolved on this device: finished or skipped, delivered or not. */
export function isResolved(record: LocalSession): boolean {
  return record.status === "FINISHED" || record.status === "SKIPPED";
}

export class SessionStore {
  #records: ReadonlyMap<string, LocalSession> = new Map();
  /**
   * Workouts whose finish or skip was delivered and whose record was then
   * dropped: workout id -> the settle's sequence number (`settledMark`).
   * What's next keeps treating them as resolved until a server read that
   * began after it arrives, so home never flashes the old workout between
   * the ack and the refetch.
   */
  #settled: ReadonlyMap<string, number> = new Map();
  #settles = 0;
  readonly #listeners = new Set<() => void>();
  readonly #now: () => Date;
  /**
   * The start or skip running for each workout. A second call for the same
   * workout (a double tap, a key repeat, two screens) waits for the first and
   * then finds its record, so one workout never gets two sessions queued.
   */
  readonly #byWorkout = new Map<string, Promise<unknown>>();

  constructor(
    private readonly db: LocalDb,
    private readonly queue: MutationQueue,
    private readonly options: SessionStoreOptions,
  ) {
    this.#now = options.now ?? (() => new Date());
  }

  getSnapshot = (): ReadonlyMap<string, LocalSession> => this.#records;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /**
   * Reads the records. A FINISHED record with nothing left in the queue was
   * fully delivered; if the app stopped between the last ack and dropping it,
   * it is dropped now, so it never lingers as a workout to resume.
   */
  async load(): Promise<void> {
    const tx = this.db.transaction(["sessions", "queue"], "readwrite");
    const [all, items] = await Promise.all([
      tx.objectStore("sessions").getAll(),
      tx.objectStore("queue").getAll(),
    ]);
    const queued = new Set(items.map((i) => i.sessionId));
    const orphans = all.filter(
      (r) => isResolved(r) && !queued.has(r.sessionId),
    );
    await Promise.all(
      orphans.map((r) => tx.objectStore("sessions").delete(r.sessionId)),
    );
    await tx.done;
    const kept = all.filter((r) => !orphans.includes(r));
    this.#records = new Map(kept.map((r) => [r.sessionId, r]));
    this.#emit();
  }

  get(sessionId: string): LocalSession | undefined {
    return this.#records.get(sessionId);
  }

  /** See `#settled`. Changes only together with the records snapshot. */
  settledWorkouts(): ReadonlyMap<string, number> {
    return this.#settled;
  }

  /**
   * The newest settle's sequence number. A what's-next read records it when
   * it starts; every workout settled after that is newer than the read.
   */
  settledMark(): number {
    return this.#settles;
  }

  /**
   * Starts `workoutId` (operations.md §4.2): one session, no exercises, no
   * sets. Uses the prefetched context, so it works offline; online, a workout
   * that was never prefetched is fetched first. Starting a workout that
   * already has a local in-progress session returns that one instead, even
   * when the two calls overlap (`#serial`).
   */
  start(workoutId: string): Promise<string> {
    return this.#serial(workoutId, () => this.#start(workoutId));
  }

  async #start(workoutId: string): Promise<string> {
    const userId = this.#requireUser();
    const existing = [...this.#records.values()].find(
      (r) =>
        r.workoutId === workoutId &&
        r.status === "IN_PROGRESS" &&
        r.userId === userId,
    );
    if (existing) return existing.sessionId;

    let context: WorkoutContextResponse;
    try {
      context = await this.options.contexts.ensure(workoutId, userId);
    } catch (error) {
      throw new LocalSessionError(
        "no-context",
        "This workout wasn't saved to the device before the signal dropped. Open the app with a connection once, then it will start offline.",
        { cause: error },
      );
    }

    const sessionId = newId();
    const performedAt = this.#now().toISOString();
    const body = startWorkoutRequest.parse({ workoutId, performedAt });
    const record: LocalSession = {
      sessionId,
      userId,
      workoutId,
      performedAt,
      status: "IN_PROGRESS",
      finishedAt: null,
      context,
      exercises: [],
    };
    await this.#commit(record, {
      op: "start",
      request: { method: "PUT", path: `/api/sessions/${sessionId}`, body },
      sessionId,
      affects: [sessionId],
      userId,
    });
    return sessionId;
  }

  /**
   * Skips `workoutId` before it starts (operations.md 4.14; design D15 of
   * step-4a): one SKIPPED session, minted here, queued in its own lane like
   * a start, so it works offline. The record resolves the workout on this
   * device at once; the server rolls the program over when the skip
   * arrives. A workout this device has already started, finished or skipped
   * is refused (a started one is finished instead); skipping the same
   * workout twice, overlapping or not, returns the first skip.
   */
  skip(workoutId: string): Promise<string> {
    return this.#serial(workoutId, () => this.#skip(workoutId));
  }

  async #skip(workoutId: string): Promise<string> {
    const userId = this.#requireUser();
    const existing = [...this.#records.values()].find(
      (r) => r.workoutId === workoutId && r.userId === userId,
    );
    if (existing?.status === "SKIPPED") return existing.sessionId;
    if (existing) {
      const name = existing.context.workout.name;
      throw new LocalSessionError(
        "already-started",
        existing.status === "IN_PROGRESS"
          ? `${name} is already started, so it can't be skipped. Finish it instead.`
          : `${name} is already done, so it can't be skipped.`,
      );
    }

    let context: WorkoutContextResponse;
    try {
      context = await this.options.contexts.ensure(workoutId, userId);
    } catch (error) {
      throw new LocalSessionError(
        "no-context",
        "This workout wasn't saved to the device before the signal dropped. Skip it once you're back online.",
        { cause: error },
      );
    }

    const sessionId = newId();
    const performedAt = this.#now().toISOString();
    const body = skipWorkoutRequest.parse({ sessionId, performedAt });
    const record: LocalSession = {
      sessionId,
      userId,
      workoutId,
      performedAt,
      status: "SKIPPED",
      finishedAt: performedAt,
      context,
      exercises: [],
    };
    await this.#commit(record, {
      op: "skip",
      request: {
        method: "POST",
        path: `/api/workouts/${encodeURIComponent(workoutId)}/skip`,
        body,
      },
      sessionId,
      affects: [sessionId],
      userId,
    });
    return sessionId;
  }

  /**
   * Logs a set against a planned exercise (§4.3-4.4). The first set mints the
   * session exercise too; both travel in one request (design D5). The unit is
   * resolved here, override first.
   */
  async logSet(
    sessionId: string,
    input: { plannedExerciseId: string; reps: number; weight: number },
  ): Promise<string> {
    const setId = newId();
    const minted = newId();
    await this.#mutate(sessionId, (record) => {
      const planned = record.context.exercises.find(
        (e) => e.plannedExerciseId === input.plannedExerciseId,
      );
      if (!planned) {
        throw new LocalSessionError(
          "unknown-exercise",
          "That exercise isn't part of this workout.",
        );
      }
      // A placeholder slot has no exercise to log against until 4c fills
      // it, and the logger takes weight and reps only (design D12).
      const exerciseId = planned.exerciseId;
      if (exerciseId === null || !isLoggable(planned)) {
        throw new LocalSessionError(
          "not-loggable",
          "Logging this slot isn't available yet.",
        );
      }
      const entry: LocalSessionExercise = record.exercises.find(
        (e) => e.plannedExerciseId === planned.plannedExerciseId,
      ) ?? {
        id: minted,
        plannedExerciseId: planned.plannedExerciseId,
        exerciseId,
        position: planned.position,
        sets: [],
      };
      const set: LocalSet = {
        id: setId,
        setNumber: entry.sets.length + 1,
        reps: input.reps,
        weight: input.weight,
        weightUnit: resolveUnit(record.context.units, exerciseId),
        loggedAt: this.#now().toISOString(),
      };
      const body = logSetRequest.parse({
        sessionExercise: {
          id: entry.id,
          sessionId,
          exerciseId: entry.exerciseId,
          plannedExerciseId: entry.plannedExerciseId,
          position: entry.position,
        },
        setNumber: set.setNumber,
        reps: set.reps,
        weight: set.weight,
        weightUnit: set.weightUnit,
        loggedAt: set.loggedAt,
      });
      const updated = { ...entry, sets: [...entry.sets, set] };
      return {
        record: {
          ...record,
          exercises: [
            ...record.exercises.filter((e) => e.id !== entry.id),
            updated,
          ].sort((a, b) => a.position - b.position),
        },
        item: {
          op: "log",
          request: { method: "PUT", path: `/api/sets/${setId}`, body },
          sessionId,
          affects: [setId],
          userId: record.userId,
        },
      };
    });
    return setId;
  }

  /**
   * Corrects a set's reps and weight (§4.15). Absolute values; the number and
   * the stamped unit stay as they were, so no unit is sent.
   */
  async editSet(
    sessionId: string,
    setId: string,
    input: { reps: number; weight: number },
  ): Promise<void> {
    const body = editSetRequest.parse({
      reps: input.reps,
      weight: input.weight,
    });
    await this.#mutate(sessionId, (record) => {
      const entry = findEntry(record, setId);
      return {
        record: replaceEntry(record, {
          ...entry,
          sets: entry.sets.map((s) =>
            s.id === setId ? { ...s, reps: body.reps, weight: body.weight } : s,
          ),
        }),
        item: {
          op: "edit",
          request: { method: "PATCH", path: `/api/sets/${setId}`, body },
          sessionId,
          affects: [setId],
          userId: record.userId,
        },
      };
    });
  }

  /**
   * Deletes a set (§4.16), mirroring the server's one transaction: the
   * survivors renumber 1..n in their order, and an exercise left with no sets
   * disappears (design D6), so it reads as skipped. The renumbered survivors
   * show as queued until the delete is acknowledged.
   */
  async deleteSet(sessionId: string, setId: string): Promise<void> {
    await this.#mutate(sessionId, (record) => {
      const entry = findEntry(record, setId);
      const survivors = entry.sets
        .filter((s) => s.id !== setId)
        .sort((a, b) => a.setNumber - b.setNumber)
        .map((s, i) => ({ ...s, setNumber: i + 1 }));
      const renumbered = survivors
        .filter(
          (s) =>
            entry.sets.find((o) => o.id === s.id)?.setNumber !== s.setNumber,
        )
        .map((s) => s.id);
      return {
        record:
          survivors.length === 0
            ? {
                ...record,
                exercises: record.exercises.filter((e) => e.id !== entry.id),
              }
            : replaceEntry(record, { ...entry, sets: survivors }),
        item: {
          op: "delete",
          request: { method: "DELETE", path: `/api/sets/${setId}` },
          sessionId,
          affects: renumbered,
          userId: record.userId,
        },
      };
    });
  }

  /**
   * Finishes the session (§4.13). The record stays until every write for the
   * session is acknowledged, then `acknowledged` drops it. Finishing twice is
   * a no-op.
   */
  async finish(sessionId: string): Promise<void> {
    await this.#mutate(
      sessionId,
      (record) =>
        record.status !== "IN_PROGRESS"
          ? { record, item: null }
          : {
              record: {
                ...record,
                status: "FINISHED",
                finishedAt: this.#now().toISOString(),
              },
              item: {
                op: "finish",
                request: {
                  method: "POST",
                  path: `/api/sessions/${sessionId}/finish`,
                },
                sessionId,
                affects: [sessionId],
                userId: record.userId,
              },
            },
      { allowFinished: true },
    );
  }

  /**
   * Builds a local record for an in-progress session this device never saw
   * (started elsewhere, or storage cleared), so it can be resumed. Online only.
   * Sets already logged come across under their existing session-exercise
   * rows, so the next set continues the same row and numbering instead of
   * minting a second one. Nothing is queued: the server already has all of it.
   */
  async adopt(
    detail: SessionDetailResponse,
    context: WorkoutContextResponse,
  ): Promise<void> {
    if (this.#records.has(detail.session.id)) return;
    const exercises: LocalSessionExercise[] = detail.exercises.flatMap((e) =>
      e.sessionExerciseId === null
        ? []
        : [
            {
              id: e.sessionExerciseId,
              plannedExerciseId: e.plannedExerciseId,
              exerciseId: e.exerciseId,
              position: e.position,
              sets: [...e.sets]
                .sort((a, b) => a.setNumber - b.setNumber)
                .map((s) => ({
                  id: s.id,
                  setNumber: s.setNumber,
                  reps: s.reps ?? 0,
                  weight: s.weight ?? 0,
                  weightUnit:
                    s.weightUnit ?? resolveUnit(context.units, e.exerciseId),
                  // The detail carries no per-set time; these sets are
                  // already delivered, so it is never sent.
                  loggedAt: detail.session.performedAt,
                })),
            },
          ],
    );
    const record: LocalSession = {
      sessionId: detail.session.id,
      userId: this.#requireUser(),
      workoutId: detail.session.workoutId,
      performedAt: detail.session.performedAt,
      status: "IN_PROGRESS",
      finishedAt: null,
      context,
      exercises: exercises.sort((a, b) => a.position - b.position),
    };
    await this.db.put("sessions", record);
    this.#setRecord(record);
  }

  /**
   * The queue's ack hook: a finished or skipped, fully delivered session is
   * dropped, and its workout remembered as settled (`#settled`).
   */
  async acknowledged(item: QueueItem): Promise<void> {
    const record = this.#records.get(item.sessionId);
    if (!record || !isResolved(record)) return;
    const tx = this.db.transaction(["sessions", "queue"], "readwrite");
    const remaining = (await tx.objectStore("queue").getAll()).some(
      (i) => i.sessionId === item.sessionId,
    );
    if (!remaining) await tx.objectStore("sessions").delete(item.sessionId);
    await tx.done;
    if (!remaining) {
      const next = new Map(this.#records);
      next.delete(item.sessionId);
      this.#settles += 1;
      this.#settled = new Map(this.#settled).set(
        record.workoutId,
        this.#settles,
      );
      this.#records = next;
      this.#emit();
    }
  }

  /**
   * Another account signed in: drops the previous account's records, except
   * those with writes still queued (they stay, held, until that account signs
   * in again and they sync).
   */
  async forgetOtherUsers(userId: string): Promise<void> {
    const queued = new Set(this.queue.getState().items.map((i) => i.sessionId));
    const drop = [...this.#records.values()].filter(
      (r) => r.userId !== userId && !queued.has(r.sessionId),
    );
    if (drop.length === 0) return;
    const tx = this.db.transaction("sessions", "readwrite");
    await Promise.all([
      ...drop.map((r) => tx.store.delete(r.sessionId)),
      tx.done,
    ]);
    const next = new Map(this.#records);
    for (const r of drop) next.delete(r.sessionId);
    this.#records = next;
    this.#emit();
  }

  /** Runs `work` after every earlier start or skip of `workoutId` settles. */
  #serial<T>(workoutId: string, work: () => Promise<T>): Promise<T> {
    const before = this.#byWorkout.get(workoutId) ?? Promise.resolve();
    const run = before.then(work, work);
    this.#byWorkout.set(workoutId, run);
    const release = () => {
      if (this.#byWorkout.get(workoutId) === run)
        this.#byWorkout.delete(workoutId);
    };
    run.then(release, release);
    return run;
  }

  async #mutate(
    sessionId: string,
    change: (record: LocalSession) => Change,
    { allowFinished = false } = {},
  ): Promise<void> {
    const tx = this.db.transaction(["sessions", "queue"], "readwrite");
    // An abort rejects `done`; the error that caused it is what callers see.
    tx.done.catch(() => undefined);
    let result: Change;
    try {
      const record = await tx.objectStore("sessions").get(sessionId);
      if (!record) {
        throw new LocalSessionError(
          "not-found",
          "That workout isn't on this device.",
        );
      }
      if (isResolved(record) && !allowFinished) {
        throw new LocalSessionError(
          "finished",
          "This workout is finished; its sets can't change.",
        );
      }
      result = change(record);
      if (result.item) {
        await tx.objectStore("sessions").put(result.record);
        await addToQueue(tx.objectStore("queue"), result.item, this.#now());
      }
    } catch (error) {
      tx.abort();
      throw error;
    }
    await tx.done;
    if (!result.item) return;
    this.#setRecord(result.record);
    await this.queue.committed();
  }

  async #commit(record: LocalSession, item: QueueItemInput): Promise<void> {
    const tx = this.db.transaction(["sessions", "queue"], "readwrite");
    await Promise.all([
      tx.objectStore("sessions").put(record),
      addToQueue(tx.objectStore("queue"), item, this.#now()),
      tx.done,
    ]);
    this.#setRecord(record);
    await this.queue.committed();
  }

  #requireUser(): string {
    const userId = this.options.userId();
    if (!userId) {
      throw new LocalSessionError(
        "not-signed-in",
        "Sign in to start a workout, so your sets are saved to your account.",
      );
    }
    return userId;
  }

  #setRecord(record: LocalSession): void {
    const next = new Map(this.#records);
    next.set(record.sessionId, record);
    this.#records = next;
    this.#emit();
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}

function findEntry(record: LocalSession, setId: string): LocalSessionExercise {
  const entry = record.exercises.find((e) =>
    e.sets.some((s) => s.id === setId),
  );
  if (!entry) {
    throw new LocalSessionError(
      "unknown-set",
      "That set isn't in this workout.",
    );
  }
  return entry;
}

function replaceEntry(
  record: LocalSession,
  entry: LocalSessionExercise,
): LocalSession {
  return {
    ...record,
    exercises: record.exercises.map((e) => (e.id === entry.id ? entry : e)),
  };
}
