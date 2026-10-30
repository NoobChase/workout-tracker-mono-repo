import type {
  ApplyPreviewResponse,
  CopyProgramRequest,
  CreateExerciseRequest,
  CreateProgramRequest,
  CycleDetailResponse,
  EditExerciseRequest,
  ExerciseNotesRequest,
  ExerciseResponse,
  ExercisesResponse,
  ExtendProgramRequest,
  HistoryPageResponse,
  ProgramDetailResponse,
  ProgramListResponse,
  ProgramResponse,
  RenameProgramRequest,
  SaveCycleRequest,
  SaveCycleResponse,
  SessionDetailResponse,
  StartFromTemplateRequest,
  TemplatesResponse,
  WhatsNextResponse,
  WorkoutContextResponse,
} from "@workout-tracker/shared";
import {
  currentClerkUserId,
  isAuthReady,
  isOnline,
  subscribeAuth,
} from "../auth.js";
import { ContextCache } from "./contexts.js";
import {
  DEFAULT_DB_NAME,
  onLocalDbEvent,
  openLocalDb,
  type LocalDb,
} from "./db.js";
import { DraftStore } from "./drafts.js";
import { LastUserStore } from "./last-user.js";
import type {
  FinishAndStartResult,
  InProgressEntry,
  ServerNext,
} from "./next-view.js";
import {
  buildOutline,
  cyclesToFetch,
  successorOf,
  type ProgramOutline,
  type Successor,
} from "./outline.js";
import {
  MutationQueue,
  type QueueItem,
  type Timers,
  type Transport,
} from "./queue.js";
import { LocalSessionError, SessionStore } from "./sessions.js";

/**
 * The server, for everything that isn't a queued logging write: online-only
 * reads and plan-side writes, through `apiFetch`. Plan-side writes never
 * queue (operations.md 0.3): they need a connection, and carry client-minted
 * ids so a retry after a lost response is harmless.
 */
export interface ServerApi {
  next(): Promise<WhatsNextResponse>;
  context(workoutId: string): Promise<WorkoutContextResponse>;
  templates(): Promise<TemplatesResponse>;
  startFromTemplate(
    request: StartFromTemplateRequest,
  ): Promise<ProgramResponse>;
  history(cursor: string | null): Promise<HistoryPageResponse>;
  session(sessionId: string): Promise<SessionDetailResponse>;
  programs(): Promise<ProgramListResponse>;
  program(programId: string): Promise<ProgramDetailResponse>;
  cycle(programId: string, cycleNumber: number): Promise<CycleDetailResponse>;
  renameProgram(
    programId: string,
    request: RenameProgramRequest,
  ): Promise<ProgramResponse>;
  copyProgram(
    programId: string,
    request: CopyProgramRequest,
  ): Promise<ProgramResponse>;
  activateProgram(programId: string): Promise<ProgramResponse>;
  archiveProgram(programId: string): Promise<ProgramResponse>;
  extendProgram(
    programId: string,
    request: ExtendProgramRequest,
  ): Promise<ProgramResponse>;
  createProgram(request: CreateProgramRequest): Promise<ProgramResponse>;
  applyPreview(
    programId: string,
    cycleNumber: number,
  ): Promise<ApplyPreviewResponse>;
  saveCycle(
    programId: string,
    cycleNumber: number,
    request: SaveCycleRequest,
  ): Promise<SaveCycleResponse>;
  /** Every exercise the user can see, their own retired ones included. */
  exercises(): Promise<ExercisesResponse>;
  createExercise(request: CreateExerciseRequest): Promise<ExerciseResponse>;
  editExercise(
    exerciseId: string,
    request: EditExerciseRequest,
  ): Promise<ExerciseResponse>;
  saveExerciseNotes(
    exerciseId: string,
    request: ExerciseNotesRequest,
  ): Promise<ExerciseResponse>;
  retireExercise(exerciseId: string): Promise<ExerciseResponse>;
  reactivateExercise(exerciseId: string): Promise<ExerciseResponse>;
}

export interface Connectivity {
  isOnline: () => boolean;
  subscribe: (listener: () => void) => () => void;
}

export interface AuthSignal {
  /** Clerk has loaded with a session, so reads can carry a token. */
  isReady: () => boolean;
  subscribe: (listener: () => void) => () => void;
}

export const browserConnectivity: Connectivity = {
  isOnline,
  subscribe(listener) {
    window.addEventListener("online", listener);
    window.addEventListener("offline", listener);
    return () => {
      window.removeEventListener("online", listener);
      window.removeEventListener("offline", listener);
    };
  },
};

export const clerkAuthSignal: AuthSignal = {
  isReady: isAuthReady,
  subscribe: subscribeAuth,
};

export interface DataLayerOptions {
  api: ServerApi;
  transport: Transport;
  dbName?: string;
  connectivity?: Connectivity;
  auth?: AuthSignal;
  currentUserId?: () => string | null | undefined;
  now?: () => Date;
  timers?: Timers;
  lock?: <T>(run: () => Promise<T>) => Promise<T>;
  requestTimeoutMs?: number;
}

/**
 * Everything the screens read and write, wired once at startup: the local
 * database, the mutation queue, the session records, the context cache and
 * the last signed-in user. `createDataLayer` opens IndexedDB and loads what is
 * stored (fast, no network), registers the queue's flush triggers (the
 * `online` event, the backoff timer, enqueue) and runs the app-start flush.
 */
export class DataLayer {
  readonly queue: MutationQueue;
  readonly sessions: SessionStore;
  readonly contexts: ContextCache;
  readonly lastUser: LastUserStore;
  readonly drafts: DraftStore;
  readonly connectivity: Connectivity;
  readonly auth: AuthSignal;
  readonly #ackListeners = new Set<(item: QueueItem) => void>();
  readonly #cleanup: (() => void)[] = [];
  readonly #clerkUserId: () => string | null | undefined;
  readonly #dbName: string;
  /** What's next that loaded before any user was known; stored once one is. */
  #unsavedNext: WhatsNextResponse | null = null;
  #lastPrefetch: Promise<unknown> = Promise.resolve();

  constructor(
    readonly db: LocalDb,
    readonly api: ServerApi,
    options: DataLayerOptions,
  ) {
    const now = options.now ?? (() => new Date());
    this.connectivity = options.connectivity ?? browserConnectivity;
    this.auth = options.auth ?? clerkAuthSignal;
    this.#clerkUserId = options.currentUserId ?? currentClerkUserId;
    this.#dbName = options.dbName ?? DEFAULT_DB_NAME;
    this.lastUser = new LastUserStore(db);
    this.drafts = new DraftStore(db, now);
    this.contexts = new ContextCache(db, (id) => api.context(id), now);
    this.queue = new MutationQueue(db, {
      transport: options.transport,
      isOnline: () => this.connectivity.isOnline(),
      currentUserId: this.#clerkUserId,
      now,
      timers: options.timers,
      lock: options.lock,
      requestTimeoutMs: options.requestTimeoutMs,
      onAck: async (item) => {
        await this.sessions.acknowledged(item);
        for (const listener of this.#ackListeners) listener(item);
      },
    });
    this.sessions = new SessionStore(db, this.queue, {
      contexts: this.contexts,
      userId: () => this.userId(),
      now,
    });
  }

  async start(): Promise<void> {
    await Promise.all([
      this.queue.load(),
      this.sessions.load(),
      this.lastUser.load(),
    ]);
    // A newer version took the database (another tab, after a deploy): the
    // connection has closed itself, so stop the queue before it tries to use
    // it. The screens ask for a reload; the queue resumes from IndexedDB then.
    this.#cleanup.push(
      onLocalDbEvent((event) => {
        if (event.kind === "replaced" && event.name === this.#dbName)
          this.close();
      }),
    );
    this.#cleanup.push(
      this.connectivity.subscribe(() => {
        if (this.connectivity.isOnline()) void this.queue.kick();
      }),
      this.auth.subscribe(() => {
        void this.queue.kick();
        this.#saveUnsavedNext();
      }),
    );
    void this.queue.kick();
  }

  /**
   * Who owns new writes and cached plans: the user Clerk has signed in now,
   * else the last user recorded on this device, else `null` (writes refuse).
   * Clerk's id counts as soon as Clerk has one, before the `ready`-only "last
   * signed-in user" record is written: the stamp only decides whether a write
   * is held for another account, and the server checks every write against a
   * verified token anyway, so it can at worst hold a write, never misdeliver.
   */
  userId(): string | null {
    const live = this.#clerkUserId();
    if (typeof live === "string") return live;
    return this.lastUser.getSnapshot()?.userId ?? null;
  }

  /** Settles when the latest prefetch has (for tests and diagnostics). */
  prefetchSettled(): Promise<unknown> {
    return this.#lastPrefetch;
  }

  /**
   * What's next from the server, stored for offline, with each listed
   * workout's context prefetched (design D9), and each program's outline
   * with its following workout's context too (step 4a D15), so a skip or a
   * "Finish & start next" can move on with no signal. `prefetched` settles
   * when every fetch has; one failing doesn't fail the others. `next` says
   * which delivered finishes and skips the read had already seen.
   */
  async loadNext(): Promise<{
    next: ServerNext;
    prefetched: Promise<unknown>;
  }> {
    const settledThrough = this.sessions.settledMark();
    const response = await this.api.next();
    const next = { response, settledThrough };
    const userId = this.userId();
    if (!userId) {
      // Stored and prefetched as soon as a user is known (`signedIn`, or
      // Clerk reporting one).
      this.#unsavedNext = response;
      return { next, prefetched: Promise.resolve() };
    }
    this.#unsavedNext = null;
    return { next, prefetched: this.#store(userId, response) };
  }

  #store(userId: string, next: WhatsNextResponse): Promise<unknown> {
    const run = (async () => {
      await this.contexts.saveNext(userId, next);
      const [contexts] = await Promise.all([
        this.contexts.prefetch(userId, next),
        this.#prefetchOutlines(userId, next).catch((error) => {
          console.warn("Saving what comes next for offline failed", error);
        }),
      ]);
      return contexts;
    })().catch((error) => {
      console.warn("Saving workouts for offline failed", error);
    });
    this.#lastPrefetch = run;
    return run;
  }

  /**
   * Each listed program's outline (its next's cycle, and the following one
   * when a fixed program has it), then the context of the workout after
   * each next. A program whose cycles fail to load is left out; home then
   * falls back to waiting for the server after a local skip or finish.
   */
  async #prefetchOutlines(
    userId: string,
    next: WhatsNextResponse,
  ): Promise<void> {
    if (next.next.length === 0) {
      await this.contexts.saveOutline(userId, []);
      return;
    }
    const { programs } = await this.api.programs();
    const results = await Promise.allSettled(
      next.next.map(async (item): Promise<ProgramOutline> => {
        const program = programs.find((p) => p.id === item.programId);
        const cycles = await Promise.all(
          cyclesToFetch(item, program).map((n) =>
            this.api.cycle(item.programId, n),
          ),
        );
        return buildOutline(
          {
            id: item.programId,
            name: item.programName,
            targetCycles: program?.targetCycles ?? null,
          },
          cycles,
        );
      }),
    );
    const outlines = results.flatMap((r) =>
      r.status === "fulfilled" ? [r.value] : [],
    );
    await this.contexts.saveOutline(userId, outlines);
    const following = next.next.flatMap((item) => {
      const after = successorOf(outlines, item.workoutId, new Set());
      return after.kind === "workout" ? [after.item.workoutId] : [];
    });
    await this.contexts.prefetchWorkouts(userId, following);
  }

  #saveUnsavedNext(): void {
    const next = this.#unsavedNext;
    const userId = this.userId();
    if (!next || !userId) return;
    this.#unsavedNext = null;
    void this.#store(userId, next);
  }

  /**
   * Clerk is `ready` with a user. Records them, and forgets every other
   * account's cached plan, session records and builder drafts (their unsent
   * writes stay queued, held until that account signs in again). Every time,
   * not only when another user was recorded: signing out clears the record,
   * so the next account to sign in would otherwise inherit what the last one
   * left on the device.
   */
  async signedIn(user: {
    userId: string;
    email: string | null;
  }): Promise<void> {
    await this.lastUser.record({
      ...user,
      recordedAt: new Date().toISOString(),
    });
    await this.contexts.forgetOtherUsers(user.userId);
    await this.sessions.forgetOtherUsers(user.userId);
    await this.drafts.forgetOtherUsers(user.userId);
    this.#saveUnsavedNext();
    void this.queue.kick();
  }

  /**
   * Brings a session started on another device (or before this device's
   * storage was cleared) here, so it can be resumed or finished: its detail
   * and its workout's plan are read, and its logged sets come across
   * (`SessionStore.adopt`). Needs a connection the first time; a session
   * already on the device needs nothing.
   */
  async ensureOnDevice(
    entry: Pick<InProgressEntry, "sessionId" | "workoutId">,
    doing: "Continuing" | "Finishing" = "Continuing",
  ): Promise<void> {
    if (this.sessions.get(entry.sessionId)) return;
    if (!this.connectivity.isOnline()) {
      throw new LocalSessionError(
        "needs-connection",
        `This workout was started on another device. ${doing} it here needs a connection the first time.`,
      );
    }
    const [detail, context] = await Promise.all([
      this.api.session(entry.sessionId),
      this.contexts.ensure(entry.workoutId, this.userId()),
    ]);
    await this.sessions.adopt(detail, context);
  }

  /**
   * "Finish & start next" (spec `workout-sessions`, design D15): queues the
   * finish, then the start of the program's next workout as this device
   * computes it (`after`), in that order. The two are separate lanes, so the
   * start never waits behind the finish offline. When the device can't name
   * the next workout (an open-ended program rolling over: the server mints
   * the new cycle) and there is signal, it lets the finish reach the server,
   * reads what's next again (`reread`) and starts that.
   */
  async finishAndStartNext(
    entry: Pick<InProgressEntry, "sessionId" | "workoutId">,
    after: Successor,
    reread: () => Promise<WhatsNextResponse | undefined>,
  ): Promise<FinishAndStartResult> {
    await this.ensureOnDevice(entry, "Finishing");
    await this.sessions.finish(entry.sessionId);

    let target = after;
    const programId =
      target.kind === "workout" ? target.item.programId : target.programId;
    if (
      (target.kind === "new-cycle" || target.kind === "unknown") &&
      programId !== null &&
      this.connectivity.isOnline()
    ) {
      await this.queue.kick();
      const delivered = !this.queue
        .getState()
        .items.some((i) => i.sessionId === entry.sessionId);
      if (delivered) {
        const fresh = await reread();
        const item = fresh?.next.find((n) => n.programId === programId);
        if (item) target = { kind: "workout", item };
      }
    }
    if (target.kind !== "workout") return { kind: "finished", after: target };
    try {
      const sessionId = await this.sessions.start(target.item.workoutId);
      return {
        kind: "started",
        sessionId,
        workoutName: target.item.workoutName,
      };
    } catch (startError) {
      return { kind: "finished", after: target, startError };
    }
  }

  /** A `ready` Clerk says nobody is signed in. Queued writes stay. */
  async signedOut(): Promise<void> {
    await this.lastUser.clear();
  }

  onAck(listener: (item: QueueItem) => void): () => void {
    this.#ackListeners.add(listener);
    return () => this.#ackListeners.delete(listener);
  }

  close(): void {
    this.queue.stop();
    for (const undo of this.#cleanup.splice(0)) undo();
    this.db.close();
  }
}

export async function createDataLayer(
  options: DataLayerOptions,
): Promise<DataLayer> {
  const db = await openLocalDb(options.dbName ?? DEFAULT_DB_NAME);
  const layer = new DataLayer(db, options.api, options);
  await layer.start();
  return layer;
}
