import { laneHeads, type QueueItem, type QueueState } from "./queue.js";

/**
 * What a row shows about its delivery, derived from the queue (design D8).
 * A row with nothing queued against it is `logged`: the server has it.
 */
export type RowSyncState =
  | "logged"
  | "queued-no-signal"
  | "queued-in-order"
  | "failed-retrying"
  | "rejected";

export interface RowSync {
  state: RowSyncState;
  /** The server's reason, for `rejected`; the last failure, for `failed-retrying`. */
  reason?: string;
}

/**
 * The one line the screens always show (offline-logging spec), aggregated
 * across every session's lane. `pending` counts queued writes of every kind
 * (start, log, edit, delete, finish) in all lanes. A rejected, held or
 * retrying summary names the session it is about; when several lanes qualify,
 * it is the oldest.
 */
export type SyncSummary =
  | { state: "synced"; pending: 0 }
  | { state: "syncing"; pending: number }
  | { state: "offline"; pending: number }
  | { state: "retrying"; pending: number; reason: string; sessionId: string }
  | { state: "rejected"; pending: number; reason: string; sessionId: string }
  | { state: "held"; pending: number; reason: string; sessionId: string };

const severity: Record<RowSyncState, number> = {
  logged: 0,
  "queued-in-order": 1,
  "queued-no-signal": 2,
  "failed-retrying": 3,
  rejected: 4,
};

function itemSync(item: QueueItem, isHead: boolean, online: boolean): RowSync {
  const failure = isHead ? item.failure : null;
  if (failure?.kind === "rejected") {
    return { state: "rejected", reason: failure.reason };
  }
  if (!online || failure?.cause === "offline") {
    return { state: "queued-no-signal" };
  }
  if (failure?.cause === "network" || failure?.cause === "server") {
    return { state: "failed-retrying", reason: failure.message };
  }
  // Waiting its turn, on the wire, or waiting for sign-in to load.
  return { state: "queued-in-order" };
}

/**
 * Each affected row's state. Only a lane's head carries a live failure; the
 * items behind it are waiting their turn. A row touched by several queued
 * writes (logged, then edited) shows the most serious of them.
 */
export function deriveRowSync(
  items: readonly QueueItem[],
  online: boolean,
): Map<string, RowSync> {
  const rows = new Map<string, RowSync>();
  const heads = new Set(laneHeads(items).map((head) => head.seq));
  items.forEach((item) => {
    const sync = itemSync(item, heads.has(item.seq), online);
    for (const id of item.affects) {
      const existing = rows.get(id);
      if (!existing || severity[sync.state] > severity[existing.state]) {
        rows.set(id, sync);
      }
    }
  });
  return rows;
}

export function rowSync(rows: Map<string, RowSync>, id: string): RowSync {
  return rows.get(id) ?? { state: "logged" };
}

export function summarize(queue: QueueState, online: boolean): SyncSummary {
  const pending = queue.items.length;
  // Nothing waiting, but no signal: say so, so a lifter knows sets will queue.
  if (pending === 0) {
    return online
      ? { state: "synced", pending: 0 }
      : { state: "offline", pending: 0 };
  }
  const heads = laneHeads(queue.items);
  for (const head of heads) {
    if (head.failure?.kind === "rejected") {
      const { reason } = head.failure;
      return { state: "rejected", pending, reason, sessionId: head.sessionId };
    }
  }
  const [held] = queue.heldLanes;
  if (held) {
    return { state: "held", pending, reason: held[1], sessionId: held[0] };
  }
  const offline = heads.some(
    (h) => h.failure?.kind === "retry" && h.failure.cause === "offline",
  );
  if (!online || offline) return { state: "offline", pending };
  for (const head of heads) {
    const failure = head.failure;
    if (
      failure?.kind === "retry" &&
      (failure.cause === "network" || failure.cause === "server")
    ) {
      return {
        state: "retrying",
        pending,
        reason: failure.message,
        sessionId: head.sessionId,
      };
    }
  }
  return { state: "syncing", pending };
}
