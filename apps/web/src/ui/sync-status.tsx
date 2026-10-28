import {
  Ban,
  Check,
  CirclePause,
  CloudOff,
  RefreshCw,
  RotateCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type SyncState =
  "synced" | "syncing" | "offline" | "retrying" | "rejected" | "held";

function plural(n: number) {
  return `${n} ${n === 1 ? "set" : "sets"}`;
}

/**
 * The words for each state, counted in sets. A start or finish waiting on its
 * own reads as the workout ("Workout queued, no signal"), never as a number
 * of writes. Exported for the screens' tests.
 */
export function syncStatusText(
  state: SyncState,
  pending = 0,
  workout = false,
): string {
  const subject =
    pending > 0 ? plural(pending) : workout ? "Workout" : undefined;
  switch (state) {
    case "synced":
      return "All sets synced";
    case "syncing":
      return subject ? `Syncing ${subject.toLowerCase()}` : "Syncing";
    case "offline":
      return subject
        ? `${subject} queued, no signal`
        : "No signal, sets will queue";
    case "retrying":
      return `${subject ?? "Sync"} failed, retrying`;
    case "rejected":
      // Lanes are per workout: only the rejected write's workout stops.
      return pending > 0
        ? "A set was rejected, its workout stopped syncing"
        : "A workout was rejected and stopped syncing";
    case "held":
      return "Sync on hold";
  }
}

const ICON = {
  synced: Check,
  syncing: RefreshCw,
  offline: CloudOff,
  retrying: RotateCw,
  rejected: Ban,
  held: CirclePause,
} as const;

/**
 * The queue's state in one line, always in the same place. It is a live
 * region, so a screen reader hears "2 sets queued, no signal" without the
 * lifter looking away from the bar. Danger only when something failed: a
 * retry, or a rejection that stopped the queue. On hold (signed out, or
 * another account's sets) is muted: nothing is wrong, it is waiting.
 */
export function SyncStatus({
  state,
  pending = 0,
  workout = false,
  className,
}: {
  state: SyncState;
  /**
   * Sets waiting in the queue (offline) or being retried. For `rejected`,
   * greater than zero when the rejected write is a set's.
   */
  pending?: number;
  /** The workout's own start or finish is among what is waiting. */
  workout?: boolean;
  className?: string;
}) {
  const Icon = ICON[state];
  return (
    <span
      role="status"
      data-slot="sync-status"
      data-state={state}
      className={cn(
        "inline-flex h-8 max-w-full items-center gap-2 rounded-md border border-line-2 px-2.5 text-[13px] whitespace-nowrap",
        state === "retrying" || state === "rejected"
          ? "text-danger"
          : "text-muted-foreground",
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        strokeWidth={1.75}
        className="size-3.5 shrink-0"
      />
      <span className="truncate">
        {syncStatusText(state, pending, workout)}
      </span>
    </span>
  );
}
