import {
  editSetRequest,
  logSetRequest,
  newId,
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
  status: "IN_PROGRESS" | "FINISHED";
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
      | "not-signed-in",
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

export class SessionStore {
  #records: ReadonlyMap<string, LocalSession> = new Map();
  readonly #listeners = new Set<() => void>();
  readonly #now: () => Date;

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
      (r) => r.status === "FINISHED" && !queued.has(r.sessionId),
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

  /**
   * Starts `workoutId` (operations.md §4.2): one session, no exercises, no
   * sets. Uses the prefetched context, so it works offline; online, a workout
   * that was never prefetched is fetched first. Starting a workout that
   * already has a local in-progress session returns that one instead.
   */
  async start(workoutId: string): Promise<string> {
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
      const entry: LocalSessionExercise = record.exercises.find(
        (e) => e.plannedExerciseId === planned.plannedExerciseId,
      ) ?? {
        id: minted,
        plannedExerciseId: planned.plannedExerciseId,
        exerciseId: planned.exerciseId,
        position: planned.position,
        sets: [],
      };
      const set: LocalSet = {
        id: setId,
        setNumber: entry.sets.length + 1,
        reps: input.reps,
        weight: input.weight,
        weightUnit: resolveUnit(record.context.units, planned.exerciseId),
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
        record.status === "FINISHED"
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

  /** The queue's ack hook: a finished, fully delivered session is dropped. */
  async acknowledged(item: QueueItem): Promise<void> {
    const record = this.#records.get(item.sessionId);
    if (record?.status !== "FINISHED") return;
    const tx = this.db.transaction(["sessions", "queue"], "readwrite");
    const remaining = (await tx.objectStore("queue").getAll()).some(
      (i) => i.sessionId === item.sessionId,
    );
    if (!remaining) await tx.objectStore("sessions").delete(item.sessionId);
    await tx.done;
    if (!remaining) {
      const next = new Map(this.#records);
      next.delete(item.sessionId);
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
      if (record.status === "FINISHED" && !allowFinished) {
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
