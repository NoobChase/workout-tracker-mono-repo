import type { IDBPObjectStore, StoreNames } from "idb";
import { ApiError, NetworkError, type ApiPath } from "../api.js";
import { AuthNotReadyError, OfflineError } from "../auth.js";
import type { LocalDb, TanrenDb } from "./db.js";

/**
 * The offline mutation queue (design D7): one IndexedDB store keyed by an
 * increasing sequence, flushed one item at a time. Every write from the
 * logging UI goes through here -- never a bare fetch (root CLAUDE.md).
 *
 * Items are grouped into lanes, one per session. Within a lane, an item is
 * never sent until every earlier item of that session is acknowledged
 * (offline-logging spec). A lane that is held (another account), stopped
 * (rejected) or waiting out a backoff blocks only itself; every other lane
 * keeps going. Across lanes there is still exactly one flusher (Web Locks)
 * and one request in flight, always the lowest-sequence ready head: a phone
 * on one bar of signal gains nothing from parallel requests, and one at a
 * time keeps the server's view of the device simple. Each failure falls into
 * one class:
 *
 * | Failure                                         | Class    | Effect                               |
 * |-------------------------------------------------|----------|--------------------------------------|
 * | offline, `clerk_offline`, network, 5xx, 429     | retry    | backoff 1s, doubling, capped at 30s  |
 * | 401                                             | refresh  | fresh token, then one immediate retry |
 * | 408, or a 4xx without the API's `{ ok:false }` JSON | retry | same backoff (an edge, not our API) |
 * | our API's JSON 4xx (400/402/403/404/409/422)    | rejected | that session's lane stops here       |
 *
 * A rejected item stays at its lane's head with its reason until the lifter
 * acts on it (`retryRejected`); that session's later writes depend on it, so
 * none are sent past it. Other sessions are unaffected.
 */

export type QueueOp = "start" | "log" | "edit" | "delete" | "finish";

/** A validated wire request, built from a `packages/shared` schema. */
export interface Mutation {
  method: "PUT" | "POST" | "PATCH" | "DELETE";
  path: ApiPath;
  body?: unknown;
}

/** Why a retryable send failed: no signal, no route, the server, or sign-in. */
export type RetryCause = "offline" | "network" | "server" | "auth";

export type Failure =
  | {
      kind: "retry";
      cause: RetryCause;
      status: number | null;
      message: string;
      at: string;
    }
  | { kind: "rejected"; status: number; reason: string; at: string };

export interface QueueItemInput {
  op: QueueOp;
  request: Mutation;
  sessionId: string;
  /** Rows whose shown sync state follows this item (a set, a session). */
  affects: string[];
  /** The signed-in user who made the write; another account never sends it. */
  userId: string | null;
}

export interface QueueItem extends QueueItemInput {
  seq: number;
  enqueuedAt: string;
  /** Failed attempts so far; drives the backoff. */
  attempts: number;
  failure: Failure | null;
}

/** Sends one request; throws the `api.ts` / `auth.ts` errors on failure. */
export type Transport = (
  request: Mutation,
  options: {
    refreshToken: boolean;
    /** Aborted when the request times out; pass it to `fetch`. */
    signal?: AbortSignal;
  },
) => Promise<void>;

/** A send that took longer than the queue's request timeout. A retry. */
export class RequestTimeoutError extends Error {
  constructor(readonly ms: number) {
    super(`The server didn't answer within ${Math.round(ms / 1000)}s`);
    this.name = "RequestTimeoutError";
  }
}

export interface Timers {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface QueueOptions {
  transport: Transport;
  isOnline: () => boolean;
  now?: () => Date;
  timers?: Timers;
  /**
   * The user Clerk says is signed in: `undefined` while it loads, `null` when
   * signed out. An item made by someone else is held, never sent.
   */
  currentUserId?: () => string | null | undefined;
  /** Runs after an item is acknowledged and removed. */
  onAck?: (item: QueueItem) => void | Promise<void>;
  /** Cross-tab exclusion for one flush. Defaults to the Web Locks API. */
  lock?: <T>(run: () => Promise<T>) => Promise<T>;
  /**
   * How long one send may take before it is abandoned and retried. Only one
   * request is in flight at a time, so a hung one would otherwise block
   * every lane. Default `REQUEST_TIMEOUT_MS`.
   */
  requestTimeoutMs?: number;
}

export interface QueueState {
  /** Everything not yet acknowledged, oldest first. */
  items: readonly QueueItem[];
  /** The item on the wire right now, if any. */
  sendingSeq: number | null;
  /** When the earliest scheduled retry fires (epoch ms), if one is scheduled. */
  retryAt: number | null;
  /** The first held lane's reason; `heldLanes` has every one. */
  held: string | null;
  /** Lanes (session ids) held without sending, with why (signed out, another account). */
  heldLanes: ReadonlyMap<string, string>;
  /** Lanes waiting out a backoff: session id -> when they retry (epoch ms). */
  backoff: ReadonlyMap<string, number>;
}

/** Each session's oldest unacknowledged item, in sequence order. */
export function laneHeads(items: readonly QueueItem[]): QueueItem[] {
  const heads = new Map<string, QueueItem>();
  for (const item of items) {
    if (!heads.has(item.sessionId)) heads.set(item.sessionId, item);
  }
  return [...heads.values()];
}

export const BACKOFF_START_MS = 1_000;
export const REQUEST_TIMEOUT_MS = 20_000;
export const BACKOFF_CAP_MS = 30_000;

/** 1s, 2s, 4s, ... capped at 30s, for the nth consecutive failure. */
export function backoffMs(attempts: number): number {
  return Math.min(
    BACKOFF_START_MS * 2 ** Math.max(0, attempts - 1),
    BACKOFF_CAP_MS,
  );
}

export type Classified =
  | { kind: "retry"; cause: RetryCause; status: number | null; message: string }
  | { kind: "refresh" }
  | { kind: "rejected"; status: number; reason: string };

export function classify(error: unknown): Classified {
  if (error instanceof OfflineError) {
    return {
      kind: "retry",
      cause: "offline",
      status: null,
      message: error.message,
    };
  }
  if (error instanceof AuthNotReadyError) {
    return {
      kind: "retry",
      cause: "auth",
      status: null,
      message: error.message,
    };
  }
  if (error instanceof RequestTimeoutError) {
    return {
      kind: "retry",
      cause: "network",
      status: null,
      message: error.message,
    };
  }
  if (error instanceof NetworkError) {
    return {
      kind: "retry",
      cause: "network",
      status: null,
      message: error.message,
    };
  }
  if (error instanceof ApiError) {
    if (error.status === 401) return { kind: "refresh" };
    if (error.status === 408 || error.status === 429 || error.status >= 500) {
      return {
        kind: "retry",
        cause: "server",
        status: error.status,
        message: error.reason ?? `The server answered ${error.status}`,
      };
    }
    // Only our API's own `{ ok: false, error }` answer is a verdict on the
    // write. A bare 4xx came from somewhere in between (CloudFront, an
    // origin-secret rotation): not the lifter's fault, so keep trying.
    if (error.status >= 400 && error.reason !== null) {
      return { kind: "rejected", status: error.status, reason: error.reason };
    }
    if (error.status >= 400) {
      return {
        kind: "retry",
        cause: "server",
        status: error.status,
        message: `The server answered ${error.status}`,
      };
    }
  }
  // Anything else is a fault on this side or in transit, never the lifter's;
  // keep the write and try again.
  return {
    kind: "retry",
    cause: "network",
    status: error instanceof ApiError ? error.status : null,
    message: error instanceof Error ? error.message : String(error),
  };
}

type QueueStore<TxStores extends ArrayLike<StoreNames<TanrenDb>>> =
  IDBPObjectStore<TanrenDb, TxStores, "queue", "readwrite">;

/**
 * Adds an item inside the caller's transaction, so a local record and its
 * queued write commit together or not at all. Call `queue.committed()` after
 * the transaction completes.
 */
export async function addToQueue<
  TxStores extends ArrayLike<StoreNames<TanrenDb>>,
>(
  store: QueueStore<TxStores>,
  input: QueueItemInput,
  now: Date,
): Promise<number> {
  // `seq` is absent on purpose: the store's autoIncrement assigns it.
  const item: Omit<QueueItem, "seq"> = {
    ...input,
    enqueuedAt: now.toISOString(),
    attempts: 0,
    failure: null,
  };
  return store.add(item as QueueItem);
}

const browserTimers: Timers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Two tabs never flush at once: one holds the lock for a whole drain. */
async function webLock<T>(run: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks) return run();
  return await locks.request("tanren-mutation-queue", run);
}

export class MutationQueue {
  #state: QueueState = {
    items: [],
    sendingSeq: null,
    retryAt: null,
    held: null,
    heldLanes: new Map(),
    backoff: new Map(),
  };
  readonly #listeners = new Set<() => void>();
  #running: Promise<void> | null = null;
  #again = false;
  /** Lanes in backoff: session id -> due time (epoch ms). */
  readonly #waiting = new Map<string, number>();
  /**
   * Bumped by every `kick()`. A send that fails after a kick arrived while
   * it was in flight doesn't impose its backoff: the kick ("signal is back",
   * "a new set was logged") means try again now, and it must not be lost.
   */
  #kicks = 0;
  #timer: unknown = null;
  #timerDue: number | null = null;
  readonly #now: () => Date;
  readonly #timers: Timers;
  readonly #lock: <T>(run: () => Promise<T>) => Promise<T>;

  constructor(
    private readonly db: LocalDb,
    private readonly options: QueueOptions,
  ) {
    this.#now = options.now ?? (() => new Date());
    this.#timers = options.timers ?? browserTimers;
    this.#lock = options.lock ?? webLock;
  }

  getState = (): QueueState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** Reads the persisted queue; what survives a reload. */
  async load(): Promise<void> {
    await this.#reload();
  }

  /** Enqueue on its own (no local record to write alongside). */
  async enqueue(input: QueueItemInput): Promise<number> {
    const seq = await addToQueue(
      this.db.transaction("queue", "readwrite").store,
      input,
      this.#now(),
    );
    await this.committed();
    return seq;
  }

  /** After a transaction that called `addToQueue` has completed. */
  async committed(): Promise<void> {
    await this.#reload();
    void this.kick();
  }

  /**
   * Starts a flush now, retrying every lane that is waiting out a backoff
   * (an enqueue, the `online` event and Clerk loading all mean "try now").
   * Returns when every lane has settled: empty, backing off, held, or stopped
   * at a rejection. Safe to call any number of times; only one flush runs.
   */
  kick(): Promise<void> {
    this.#kicks += 1;
    this.#waiting.clear();
    this.#clearTimer();
    this.#publishBackoff();
    return this.#flush();
  }

  #flush(): Promise<void> {
    if (this.#running) {
      this.#again = true;
      return this.#running;
    }
    const run = async () => {
      do {
        this.#again = false;
        try {
          await this.#lock(() => this.#drain());
        } catch (error) {
          // The store itself failed. Keep everything and try again later.
          console.error("Mutation queue flush failed", error);
          this.#schedule(BACKOFF_CAP_MS);
        }
      } while (this.#again);
    };
    this.#running = run().finally(() => {
      this.#running = null;
    });
    return this.#running;
  }

  /** Resolves when the flush in progress (if any) has settled. Starts nothing. */
  settled(): Promise<void> {
    return this.#running ?? Promise.resolve();
  }

  /**
   * Clears a rejection and sends that lane again (after the lifter acts):
   * the given session's, or every rejected lane's.
   */
  async retryRejected(sessionId?: string): Promise<void> {
    const rejected = laneHeads(this.#state.items).filter(
      (head) =>
        head.failure?.kind === "rejected" &&
        (sessionId === undefined || head.sessionId === sessionId),
    );
    if (rejected.length === 0) return;
    const tx = this.db.transaction("queue", "readwrite");
    await Promise.all([
      ...rejected.map((head) => tx.store.put({ ...head, failure: null })),
      tx.done,
    ]);
    await this.#reload();
    await this.kick();
  }

  /** Stops the backoff timer; for teardown. */
  stop(): void {
    this.#clearTimer();
  }

  async #drain(): Promise<void> {
    for (;;) {
      await this.#reload();
      const heldLanes = new Map<string, string>();
      let next: QueueItem | undefined;
      for (const head of laneHeads(this.#state.items)) {
        if (head.failure?.kind === "rejected") continue;
        const held = this.#holdReason(head);
        if (held) heldLanes.set(head.sessionId, held);
        else if (!this.#waiting.has(head.sessionId)) next ??= head;
      }
      this.#set({
        heldLanes,
        held: heldLanes.values().next().value ?? null,
      });
      if (!next) {
        this.#set({ sendingSeq: null });
        this.#armTimer();
        return;
      }

      this.#set({ sendingSeq: next.seq });
      const kicksBefore = this.#kicks;
      const result = await this.#attempt(next.request);

      if (result === "ok") {
        await this.db.delete("queue", next.seq);
        await this.#reload();
        this.#set({ sendingSeq: null });
        try {
          await this.options.onAck?.(next);
        } catch (error) {
          console.error(
            "Mutation acknowledged, but its follow-up failed",
            error,
          );
        }
        continue;
      }

      const at = this.#now().toISOString();
      const failure: Failure =
        result.kind === "rejected"
          ? {
              kind: "rejected",
              status: result.status,
              reason: result.reason,
              at,
            }
          : {
              kind: "retry",
              cause: result.cause,
              status: result.status,
              message: result.message,
              at,
            };
      const attempts = next.attempts + 1;
      await this.db.put("queue", { ...next, attempts, failure });
      this.#set({ sendingSeq: null });
      if (result.kind === "retry" && this.#kicks === kicksBefore) {
        this.#waiting.set(
          next.sessionId,
          this.#now().getTime() + backoffMs(attempts),
        );
        this.#publishBackoff();
      }
      // Either way, only this lane stops; the others carry on. (A retry that
      // a kick overtook is not parked: the loop sends it again right away.)
    }
  }

  /** One delivery: a 401 gets one fresh token and one immediate resend. */
  async #attempt(
    request: Mutation,
  ): Promise<"ok" | Exclude<Classified, { kind: "refresh" }>> {
    let refreshToken = false;
    for (;;) {
      try {
        await this.#send(request, refreshToken);
        return "ok";
      } catch (error) {
        const result = classify(error);
        if (result.kind !== "refresh") return result;
        if (refreshToken) {
          // A fresh token was refused too: back off and try again later.
          return {
            kind: "retry",
            cause: "auth",
            status: 401,
            message: "Your sign-in needs refreshing",
          };
        }
        refreshToken = true;
      }
    }
  }

  /** One send, abandoned (and aborted) after the request timeout. */
  async #send(request: Mutation, refreshToken: boolean): Promise<void> {
    const ms = this.options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Real timers, not `options.timers`: those schedule backoff only.
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new RequestTimeoutError(ms));
        controller.abort();
      }, ms);
    });
    try {
      await Promise.race([
        this.options.transport(request, {
          refreshToken,
          signal: controller.signal,
        }),
        timedOut,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  #holdReason(head: QueueItem): string | null {
    const current = this.options.currentUserId?.();
    if (current === undefined || head.userId === null) return null;
    if (current === null) return "Sign in to sync your workout.";
    if (current !== head.userId) {
      return "These sets belong to another account. Sign in as that account to sync them.";
    }
    return null;
  }

  async #reload(): Promise<void> {
    this.#set({ items: await this.db.getAll("queue") });
  }

  /** After the store itself failed: try everything again later. */
  #schedule(ms: number): void {
    this.#clearTimer();
    this.#timer = this.#timers.set(() => void this.kick(), ms);
    this.#set({ retryAt: this.#now().getTime() + ms });
  }

  /** One timer, for the earliest lane due; firing releases every lane due by then. */
  #armTimer(): void {
    const due = Math.min(...this.#waiting.values());
    if (!Number.isFinite(due)) {
      this.#clearTimer();
      this.#set({ retryAt: null });
      return;
    }
    if (this.#timer !== null && this.#timerDue === due) return;
    this.#clearTimer();
    this.#timerDue = due;
    this.#timer = this.#timers.set(
      () => {
        this.#timer = null;
        this.#timerDue = null;
        for (const [lane, at] of this.#waiting) {
          if (at <= due) this.#waiting.delete(lane);
        }
        this.#publishBackoff();
        void this.#flush();
      },
      Math.max(0, due - this.#now().getTime()),
    );
    this.#set({ retryAt: due });
  }

  #clearTimer(): void {
    if (this.#timer !== null) this.#timers.clear(this.#timer);
    this.#timer = null;
    this.#timerDue = null;
  }

  #publishBackoff(): void {
    this.#set({ backoff: new Map(this.#waiting) });
  }

  #set(patch: Partial<QueueState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener();
  }
}
