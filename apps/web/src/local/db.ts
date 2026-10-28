import type {
  WhatsNextResponse,
  WorkoutContextResponse,
} from "@workout-tracker/shared";
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { QueueItem } from "./queue.js";
import type { LocalSession } from "./sessions.js";

/**
 * The device's own store (design D7-D9). Everything the app needs to open and
 * train without a connection lives here, never in TanStack Query's cache:
 *
 * - `meta`: the last signed-in user (D10) and the last what's-next snapshot.
 * - `queue`: the mutation queue, keyed by an increasing sequence (D7).
 * - `sessions`: one record per in-progress session, what the logger renders (D8).
 * - `contexts`: each prefetched workout's context, so a start works offline (D9).
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

export interface StoredContext {
  workoutId: string;
  userId: string;
  fetchedAt: string;
  context: WorkoutContextResponse;
}

export interface TanrenDb extends DBSchema {
  meta: {
    key: "lastUser" | "next";
    value: LastUser | NextSnapshot;
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
}

export type LocalDb = IDBPDatabase<TanrenDb>;

/** The production database name. Tests pass their own so each starts empty. */
export const DEFAULT_DB_NAME = "tanren";

export function openLocalDb(name = DEFAULT_DB_NAME): Promise<LocalDb> {
  return openDB<TanrenDb>(name, 1, {
    upgrade(db) {
      db.createObjectStore("meta");
      // autoIncrement: the sequence is assigned inside the same transaction
      // that writes the item, so two enqueues can never share a number.
      db.createObjectStore("queue", { keyPath: "seq", autoIncrement: true });
      db.createObjectStore("sessions", { keyPath: "sessionId" });
      db.createObjectStore("contexts", { keyPath: "workoutId" });
    },
  });
}
