import { laneHeads, type QueueItem, type QueueOp } from "../local/queue.js";

/**
 * What the sync line says about the queue, in the lifter's terms: how many
 * sets have changes waiting, whether the workout itself (a start or a finish)
 * is waiting, and, when the queue has stopped at a rejection, which session
 * and set it stopped at. `useSyncStatus().pending` counts raw writes; a set
 * logged and then edited is one set here, not two.
 */
export interface QueueSummary {
  /** Distinct sets with a queued log, edit or delete. */
  sets: number;
  /** A start or finish is queued. */
  workout: boolean;
  /**
   * The rejected write a session's lane stopped at, if one has (the oldest,
   * when several have). Other sessions' lanes keep syncing past it.
   */
  blocked: {
    sessionId: string;
    op: QueueOp;
    /** The set it was about; `null` for a start or finish. */
    setId: string | null;
    /** The HTTP status it was refused with (402/403: not entitled). */
    status: number;
  } | null;
}

const SET_PATH = /^\/api\/sets\/([^/]+)$/;

function setIdOf(item: QueueItem): string | null {
  return SET_PATH.exec(item.request.path)?.[1] ?? null;
}

export function summarizeQueue(items: readonly QueueItem[]): QueueSummary {
  const sets = new Set<string>();
  let workout = false;
  for (const item of items) {
    const setId = setIdOf(item);
    if (setId) sets.add(setId);
    else workout = true;
  }
  const head = laneHeads(items).find((h) => h.failure?.kind === "rejected");
  return {
    sets: sets.size,
    workout,
    blocked:
      head?.failure?.kind === "rejected"
        ? {
            sessionId: head.sessionId,
            op: head.op,
            setId: setIdOf(head),
            status: head.failure.status,
          }
        : null,
  };
}
