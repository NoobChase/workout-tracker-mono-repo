import type {
  WhatsNextResponse,
  WorkoutContextResponse,
} from "@workout-tracker/shared";
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { StoredDraft } from "./drafts.js";
import type { ProgramOutline } from "./outline.js";
import type { QueueItem } from "./queue.js";
import type { LocalSession } from "./sessions.js";

/**
 * The device's own store (design D7-D9). Everything the app needs to open and
 * train without a connection lives here, never in TanStack Query's cache:
 *
 * - `meta`: the last signed-in user (D10), the last what's-next snapshot, and
 *   the active programs' outlines (step 4a D15: what comes after each next).
 * - `queue`: the mutation queue, keyed by an increasing sequence (D7).
 * - `sessions`: one record per in-progress session, what the logger renders (D8).
 * - `contexts`: each prefetched workout's context, so a start works offline (D9).
 * - `drafts`: the builder's unsaved work, per program and cycle (step 4a D14).
 *   A convenience, never synced: the builder itself is online only.
 */
export interface LastUser {
  userId: string;
  email: string | null;
  /** When Clerk last confirmed this user with `status === "ready"`. */
  recordedAt: string;
}

export interface NextSnapshot {
  userId: string;
  fetchedAt: string;
  next: WhatsNextResponse;
}

export interface OutlineSnapshot {
  userId: string;
  fetchedAt: string;
  programs: ProgramOutline[];
}

export interface StoredContext {
  workoutId: string;
  userId: string;
  fetchedAt: string;
  context: WorkoutContextResponse;
}

export interface TanrenDb extends DBSchema {
  meta: {
    key: "lastUser" | "next" | "outline";
    value: LastUser | NextSnapshot | OutlineSnapshot;
  };
  queue: {
    key: number;
    value: QueueItem;
  };
  sessions: {
    key: string;
    value: LocalSession;
  };
  contexts: {
    key: string;
    value: StoredContext;
  };
  drafts: {
    key: string;
    value: StoredDraft;
  };
}

export type LocalDb = IDBPDatabase<TanrenDb>;

/** The production database name. Tests pass their own so each starts empty. */
export const DEFAULT_DB_NAME = "tanren";

/**
 * What happens to an open across versions, for the screens to explain:
 *
 * - `blocked`: this open is waiting because another tab still holds an older
 *   version open (a deploy, with the old tab left open). It resolves as soon
 *   as that tab closes or reloads; until then the app can't start, so the
 *   bootstrap says why instead of a blank page.
 * - `replaced`: a newer version opened in another tab and this connection
 *   closed itself so the upgrade isn't held up. This tab must reload.
 */
export interface LocalDbEvent {
  kind: "blocked" | "replaced";
  name: string;
}

const dbListeners = new Set<(event: LocalDbEvent) => void>();

export function onLocalDbEvent(
  listener: (event: LocalDbEvent) => void,
): () => void {
  dbListeners.add(listener);
  return () => dbListeners.delete(listener);
}

function emit(event: LocalDbEvent) {
  for (const listener of [...dbListeners]) listener(event);
}

/**
 * Version 2 (step 4a) adds `drafts`; a device on version 1 keeps everything
 * it holds, its queue included.
 *
 * Every connection closes itself on `versionchange` (`blocking`), so a tab
 * left open across a deploy never holds a newer version's upgrade waiting.
 * A step-3 tab predates this and can still block: the waiting open reports
 * it (`blocked`) and carries on once that tab goes.
 */
export function openLocalDb(name = DEFAULT_DB_NAME): Promise<LocalDb> {
  return openDB<TanrenDb>(name, 2, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore("meta");
        // autoIncrement: the sequence is assigned inside the same transaction
        // that writes the item, so two enqueues can never share a number.
        db.createObjectStore("queue", { keyPath: "seq", autoIncrement: true });
        db.createObjectStore("sessions", { keyPath: "sessionId" });
        db.createObjectStore("contexts", { keyPath: "workoutId" });
      }
      if (oldVersion < 2) {
        db.createObjectStore("drafts", { keyPath: "key" });
      }
    },
    blocked() {
      emit({ kind: "blocked", name });
    },
    blocking(_current, _next, event) {
      (event.target as IDBDatabase).close();
      emit({ kind: "replaced", name });
    },
  });
}
