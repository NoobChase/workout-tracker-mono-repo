import { Link, useLocation, useSearchParams } from "react-router";
import { useLocalSessions, useSyncStatus } from "../data/hooks.js";
import type { QueueSummary } from "../data/queue-summary.js";
import type { LocalSession } from "../local/sessions.js";
import { Button } from "@/ui/button";
import { SyncStatus } from "@/ui/sync-status";

/**
 * The always-visible sync line (offline-logging spec), counted in sets: "3
 * sets queued, no signal", or "Workout queued, no signal" when only a start
 * or a finish is waiting.
 */
export function SyncLine({ className }: { className?: string }) {
  const sync = useSyncStatus();
  const { sets, workout, blocked } = sync.queued;
  return (
    <SyncStatus
      state={sync.state}
      pending={sync.state === "rejected" ? (blocked?.setId ? 1 : 0) : sets}
      workout={workout}
      className={className}
    />
  );
}

/**
 * When the queue has stopped (a rejection) or is on hold (signed out, another
 * account), the line alone isn't enough: this band says which write, in the
 * server's own words, and offers what the lifter can do. Rendered under the
 * header on every screen; nothing otherwise.
 */
export function SyncAlert() {
  const sync = useSyncStatus();
  const records = useLocalSessions();
  if (sync.state !== "rejected" && sync.state !== "held") return null;
  // The queue runs one lane per workout: a rejected or held write stops only
  // its own workout, named here from the session the state is about.
  const workout =
    records.get(sync.sessionId)?.context.workout.name ?? "this workout";

  return (
    <div role="alert" data-slot="sync-alert" className="border-b border-line">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-6 md:px-9">
        {sync.state === "held" ? (
          <p className="max-w-[60ch] text-[15px] text-foreground">
            {sync.reason}{" "}
            <span className="text-muted-foreground">
              Nothing is lost: {workout} waits on this device.
            </span>
          </p>
        ) : (
          <>
            <p className="max-w-[60ch] text-[15px] text-foreground">
              <span className="font-semibold text-danger">
                {describeBlocked(sync.queued.blocked, records)}
              </span>{" "}
              {sync.reason}{" "}
              <span className="text-muted-foreground">
                {notEntitled(sync.queued.blocked)
                  ? `Subscribing comes with billing, which isn’t here yet. Once your account is renewed, try again; until then the rest of ${workout} stays on this device.`
                  : `The rest of ${workout} waits behind it on this device; other workouts still sync.`}
              </span>
            </p>
            {/* Try again is the one honest recovery today: a rejected write
                is resent as it was (editing a set queues a change behind it,
                and can't replace it; design D7, deferred to step 5). */}
            <div className="flex shrink-0 gap-2 sm:ml-auto">
              <Button onClick={() => void sync.retry()}>Try again</Button>
              <ShowBlocked
                sessionId={sync.sessionId}
                blocked={sync.queued.blocked}
                records={records}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

type Blocked = QueueSummary["blocked"];
type Records = ReadonlyMap<string, LocalSession>;

function findSet(blocked: Blocked, records: Records) {
  if (!blocked?.setId) return null;
  const record = records.get(blocked.sessionId);
  for (const exercise of record?.exercises ?? []) {
    const set = exercise.sets.find((s) => s.id === blocked.setId);
    if (set) {
      const name =
        record?.context.exercises.find(
          (e) => e.plannedExerciseId === exercise.plannedExerciseId,
        )?.name ?? "this exercise";
      return { set, name };
    }
  }
  return null;
}

/** "Set 3 of Bench Press wasn’t saved:" in the lifter's terms. */
export function describeBlocked(blocked: Blocked, records: Records): string {
  const workout = blocked
    ? records.get(blocked.sessionId)?.context.workout.name
    : undefined;
  switch (blocked?.op) {
    case "log":
    case "edit": {
      const found = findSet(blocked, records);
      const what =
        blocked.op === "log" ? "wasn’t saved" : "change wasn’t saved";
      return found
        ? `Set ${found.set.setNumber} of ${found.name} ${what}:`
        : `A set ${what}:`;
    }
    case "delete":
      return "Deleting a set wasn’t saved:";
    case "start":
      return `Starting ${workout ?? "the workout"} wasn’t saved:`;
    case "finish":
      return `Finishing ${workout ?? "the workout"} wasn’t saved:`;
    case "skip":
      return `Skipping ${workout ?? "the workout"} wasn’t saved:`;
    default:
      return "A change wasn’t saved:";
  }
}

/** A rejection for the account, not the write: lapsed or not entitled. */
function notEntitled(blocked: Blocked): boolean {
  return blocked?.status === 402 || blocked?.status === 403;
}

/** A plain link to the rejected set or workout, unless it's on screen. */
function ShowBlocked({
  sessionId,
  blocked,
  records,
}: {
  /** The workout the rejection is about (`useSyncStatus().sessionId`). */
  sessionId: string;
  blocked: Blocked;
  records: Records;
}) {
  const location = useLocation();
  const [params] = useSearchParams();
  // A skipped workout has no screen to show.
  if (!records.has(sessionId) || records.get(sessionId)?.status === "SKIPPED") {
    return null;
  }
  const found =
    blocked?.sessionId === sessionId ? findSet(blocked, records) : null;
  const path = `/workout/${sessionId}`;
  const showing =
    location.pathname === path &&
    (found ? params.get("set") === found.set.id : true);
  if (showing) return null;
  return (
    <Button asChild variant="ghost">
      <Link to={found ? `${path}?set=${found.set.id}` : path}>
        {found ? "Show set" : "Show workout"}
      </Link>
    </Button>
  );
}
