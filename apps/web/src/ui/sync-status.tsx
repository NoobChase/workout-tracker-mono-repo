import { Check, CloudOff, RefreshCw, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";

export type SyncState = "synced" | "syncing" | "offline" | "retrying";

/**
 * The queue's state in one line, always in the same place. It is a live
 * region, so a screen reader hears "2 sets queued, no signal" without the
 * lifter looking away from the bar.
 */
export function SyncStatus({
  state,
  pending = 0,
  className,
}: {
  state: SyncState;
  /** Sets waiting in the queue (offline) or being retried. */
  pending?: number;
  className?: string;
}) {
  const sets = `${pending} ${pending === 1 ? "set" : "sets"}`;
  const text = {
    synced: "All sets synced",
    syncing: `Syncing ${sets}`,
    offline:
      pending > 0 ? `${sets} queued, no signal` : "No signal, sets will queue",
    retrying: `${sets} failed, retrying`,
  }[state];
  const Icon = {
    synced: Check,
    syncing: RefreshCw,
    offline: CloudOff,
    retrying: RotateCw,
  }[state];

  return (
    <span
      role="status"
      data-slot="sync-status"
      data-state={state}
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-md border border-line-2 px-2.5 text-[13px] whitespace-nowrap",
        state === "retrying" ? "text-danger" : "text-muted-foreground",
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        strokeWidth={1.75}
        className="size-3.5 shrink-0"
      />
      {text}
    </span>
  );
}
