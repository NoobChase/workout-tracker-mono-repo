import type { WhatsNextResponse } from "@workout-tracker/shared";
import { isLoggable } from "./loggable.js";
import {
  deviceNext,
  successorOf,
  type NextItem,
  type ProgramOutline,
  type Successor,
  type Waiting,
} from "./outline.js";
import { isResolved, type LocalSession } from "./sessions.js";

/*
 * What's next as home shows it (design D8, D9; step 4a D15), as one pure
 * function of what the device holds: the server's last answer (or the
 * stored snapshot), the programs' outlines and the local session records.
 * `useNext` only gathers these and adds the read's loading state.
 */

/** A workout to resume: started on this device, or elsewhere. */
export interface InProgressEntry {
  sessionId: string;
  workoutId: string;
  workoutName: string;
  programName: string;
  /** Known from the device's plan; `null` when it never saw this workout. */
  programId: string | null;
  cycleNumber: number | null;
  performedAt: string;
  /** False: started elsewhere; `DataLayer.ensureOnDevice` brings it here. */
  onDevice: boolean;
  /**
   * Exercises with a set logged, of those the logger can take (design D12),
   * from this device's record; `null` when it holds none.
   */
  progress: { logged: number; planned: number } | null;
}

/** A server what's-next read and the settles it had already seen. */
export interface ServerNext {
  response: WhatsNextResponse;
  /** `SessionStore.settledMark()` when the read began. */
  settledThrough: number;
}

export interface NextInputs {
  /** The server's answer, when one is in hand. */
  server: ServerNext | null;
  /** The snapshot stored on the device, read when the server can't be. */
  device: WhatsNextResponse | null;
  outlines: readonly ProgramOutline[];
  /** Every local session record, any account's. */
  records: ReadonlyMap<string, LocalSession>;
  /** Whose records count. */
  userId: string | null;
  /** `SessionStore.settledWorkouts()`. */
  settled: ReadonlyMap<string, number>;
}

export interface DeviceNextView {
  /**
   * One workout per active program, moved past every workout this device
   * has finished or skipped (step 4a D15), so home moves on at once.
   */
  next: NextItem[];
  /**
   * Programs whose next was resolved here and whose following workout only
   * the server can mint (an open-ended program's new cycle) or that just
   * finished; they show once the write has synced.
   */
  waiting: Waiting[];
  /** Sessions to offer for resumption, this device's first. */
  inProgress: InProgressEntry[];
  /** What follows `workoutId` once it, too, is resolved: for confirmations. */
  successorOf: (workoutId: string) => Successor;
}

export function buildNextView({
  server,
  device,
  outlines,
  records,
  userId,
  settled,
}: NextInputs): DeviceNextView {
  const data = server?.response ?? device;
  const mine = [...records.values()].filter((r) => r.userId === userId);
  const resolved = new Set(
    mine.filter(isResolved).map((record) => record.workoutId),
  );
  // Delivered and dropped, but the server read in hand began before that.
  for (const [workoutId, settle] of settled) {
    if (!server || settle > server.settledThrough) resolved.add(workoutId);
  }

  const local: InProgressEntry[] = mine
    .filter((r) => r.status === "IN_PROGRESS")
    .map((r) => ({
      sessionId: r.sessionId,
      workoutId: r.workoutId,
      workoutName: r.context.workout.name,
      programName: r.context.workout.programName,
      programId: r.context.workout.programId,
      cycleNumber: r.context.workout.cycleNumber,
      performedAt: r.performedAt,
      onDevice: true,
      progress: {
        logged: r.exercises.filter((e) => e.sets.length > 0).length,
        planned: r.context.exercises.filter(isLoggable).length,
      },
    }));
  // A session this device holds a record of is listed from the record (or,
  // resolved here, not at all), never again from the server's list.
  const remote: InProgressEntry[] = (data?.inProgress ?? [])
    .filter((s) => !records.has(s.sessionId))
    .map((s) => {
      const program = outlines.find((o) =>
        o.workouts.some((w) => w.workoutId === s.workoutId),
      );
      return {
        ...s,
        programId: program?.programId ?? null,
        cycleNumber:
          program?.workouts.find((w) => w.workoutId === s.workoutId)
            ?.cycleNumber ?? null,
        onDevice: false,
        progress: null,
      };
    });

  const moved = deviceNext(data?.next ?? [], outlines, resolved);
  return {
    next: moved.next,
    waiting: moved.waiting,
    inProgress: [...local, ...remote],
    successorOf: (workoutId) => successorOf(outlines, workoutId, resolved),
  };
}

/** What "Finish & start next" did. */
export type FinishAndStartResult =
  | { kind: "started"; sessionId: string; workoutName: string }
  | {
      kind: "finished";
      /** What follows, as far as this device could tell. */
      after: Successor;
      /** The next workout was known but couldn't start (its plan isn't here). */
      startError?: unknown;
    };
