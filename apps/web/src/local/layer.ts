import type {
  HistoryPageResponse,
  SessionDetailResponse,
  StartFromTemplateRequest,
  StartFromTemplateResponse,
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
import { DEFAULT_DB_NAME, openLocalDb, type LocalDb } from "./db.js";
import { LastUserStore } from "./last-user.js";
import {
  MutationQueue,
  type QueueItem,
  type Timers,
  type Transport,
} from "./queue.js";
import { SessionStore } from "./sessions.js";

/** Online-only reads (and the one plan-side write), through `apiFetch`. */
export interface ReadApi {
  next(): Promise<WhatsNextResponse>;
  context(workoutId: string): Promise<WorkoutContextResponse>;
  templates(): Promise<TemplatesResponse>;
  startFromTemplate(
    request: StartFromTemplateRequest,
  ): Promise<StartFromTemplateResponse>;
  history(cursor: string | null): Promise<HistoryPageResponse>;
  session(sessionId: string): Promise<SessionDetailResponse>;
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
  api: ReadApi;
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
  readonly connectivity: Connectivity;
  readonly auth: AuthSignal;
  readonly #ackListeners = new Set<(item: QueueItem) => void>();
  readonly #cleanup: (() => void)[] = [];
  readonly #clerkUserId: () => string | null | undefined;
  /** What's next that loaded before any user was known; stored once one is. */
  #unsavedNext: WhatsNextResponse | null = null;
  #lastPrefetch: Promise<unknown> = Promise.resolve();

  constructor(
    readonly db: LocalDb,
    readonly api: ReadApi,
    options: DataLayerOptions,
  ) {
    const now = options.now ?? (() => new Date());
    this.connectivity = options.connectivity ?? browserConnectivity;
    this.auth = options.auth ?? clerkAuthSignal;
    this.#clerkUserId = options.currentUserId ?? currentClerkUserId;
    this.lastUser = new LastUserStore(db);
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
   * workout's context prefetched (design D9). `prefetched` settles when every
   * context fetch has; one failing doesn't fail the others.
   */
  async loadNext(): Promise<{
    next: WhatsNextResponse;
    prefetched: Promise<unknown>;
  }> {
    const next = await this.api.next();
    const userId = this.userId();
    if (!userId) {
      // Stored and prefetched as soon as a user is known (`signedIn`, or
      // Clerk reporting one).
      this.#unsavedNext = next;
      return { next, prefetched: Promise.resolve() };
    }
    this.#unsavedNext = null;
    return { next, prefetched: this.#store(userId, next) };
  }

  #store(userId: string, next: WhatsNextResponse): Promise<unknown> {
    const run = (async () => {
      await this.contexts.saveNext(userId, next);
      return this.contexts.prefetch(userId, next);
    })().catch((error) => {
      console.warn("Saving workouts for offline failed", error);
    });
    this.#lastPrefetch = run;
    return run;
  }

  #saveUnsavedNext(): void {
    const next = this.#unsavedNext;
    const userId = this.userId();
    if (!next || !userId) return;
    this.#unsavedNext = null;
    void this.#store(userId, next);
  }

  /**
   * Clerk is `ready` with a user. Records them; if they aren't the last user,
   * the previous account's cached plan is forgotten (its unsent writes stay
   * queued, held until that account signs in again).
   */
  async signedIn(user: {
    userId: string;
    email: string | null;
  }): Promise<void> {
    const previous = this.lastUser.getSnapshot();
    await this.lastUser.record({
      ...user,
      recordedAt: new Date().toISOString(),
    });
    if (previous && previous.userId !== user.userId) {
      await this.contexts.forgetOtherUsers(user.userId);
      await this.sessions.forgetOtherUsers(user.userId);
    }
    this.#saveUnsavedNext();
    void this.queue.kick();
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
