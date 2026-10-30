import type {
  CycleDetailResponse,
  ProgramSummary,
  WhatsNextResponse,
} from "@workout-tracker/shared";

/*
 * What comes after each program's next workout, as this device knows it
 * (design D15 of step-4a). The server's what's next lists one workout per
 * active program; a skip or a finish made here, perhaps with no signal,
 * resolves that workout before the server hears of it. The outline (the
 * workouts of the next's cycle and of the cycle after it, when that exists)
 * lets home move on at once, name what moves up in the skip confirmation,
 * and lets "Finish & start next" start the right workout offline.
 *
 * Pure functions over plain data, so the rule is tested without a browser.
 */

export type NextItem = WhatsNextResponse["next"][number];

export interface OutlineWorkout {
  workoutId: string;
  name: string;
  cycleNumber: number;
  position: number;
  /**
   * The server had a session for it when the outline was read (any status:
   * resolved, or started on another device), so it is never what comes
   * next.
   */
  trained: boolean;
}

export interface ProgramOutline {
  programId: string;
  programName: string;
  /** `null`: open-ended, so finishing its newest cycle adds the next one. */
  targetCycles: number | null;
  /** The fetched cycles' workouts, in training order. */
  workouts: OutlineWorkout[];
}

/** What follows a workout once it is resolved. */
export type Successor =
  | { kind: "workout"; item: NextItem }
  /** An open-ended program rolls over: the server mints the new cycle. */
  | {
      kind: "new-cycle";
      programId: string;
      programName: string;
      cycleNumber: number;
      /** The first workout of the cycle being cloned, which the new one repeats. */
      workoutName: string | null;
    }
  /** The last workout of a fixed program: it becomes COMPLETED. */
  | { kind: "complete"; programId: string; programName: string }
  /** Not in the outline (never fetched, or beyond the cycles fetched). */
  | { kind: "unknown"; programId: string | null; programName: string | null };

/** Training order: cycle, then position within it. */
function byOrder(a: OutlineWorkout, b: OutlineWorkout): number {
  return a.cycleNumber - b.cycleNumber || a.position - b.position;
}

/**
 * Builds a program's outline from the cycles fetched for it (any order),
 * keeping each workout's `trained` flag from the cycle read. Trained
 * workouts stay in it, so a workout in progress can still be located; they
 * are only never chosen as a successor.
 */
export function buildOutline(
  program: { id: string; name: string; targetCycles: number | null },
  cycles: readonly CycleDetailResponse[],
): ProgramOutline {
  return {
    programId: program.id,
    programName: program.name,
    targetCycles: program.targetCycles,
    workouts: cycles
      .flatMap((c) =>
        c.cycle.workouts.map((w) => ({
          workoutId: w.id,
          name: w.name,
          cycleNumber: c.cycleNumber,
          position: w.position,
          trained: w.trained,
        })),
      )
      .sort(byOrder),
  };
}

/**
 * The cycles worth fetching for a program's next workout: its own, and the
 * one after when a fixed program already has it. An open-ended program's
 * next cycle doesn't exist until the server rolls it over.
 */
export function cyclesToFetch(
  item: NextItem,
  program: Pick<ProgramSummary, "targetCycles"> | undefined,
): number[] {
  const target = program?.targetCycles ?? null;
  return target !== null && item.cycleNumber < target
    ? [item.cycleNumber, item.cycleNumber + 1]
    : [item.cycleNumber];
}

/**
 * The first workout after `workoutId` in its program that isn't in
 * `resolved` and wasn't already trained on the server (skipped, finished or
 * started elsewhere), so "Finish & start next" and a skip never target a
 * resolved workout. Past the end of the outline: a new cycle for an
 * open-ended program, completion for a fixed one on its last cycle, else
 * unknown.
 */
export function successorOf(
  outlines: readonly ProgramOutline[],
  workoutId: string,
  resolved: ReadonlySet<string>,
): Successor {
  const outline = outlines.find((o) =>
    o.workouts.some((w) => w.workoutId === workoutId),
  );
  if (!outline) return { kind: "unknown", programId: null, programName: null };
  const { programId, programName } = outline;
  const at = outline.workouts.findIndex((w) => w.workoutId === workoutId);
  const later = outline.workouts
    .slice(at + 1)
    .find(
      (w) =>
        w.workoutId !== workoutId && !w.trained && !resolved.has(w.workoutId),
    );
  if (later) {
    return {
      kind: "workout",
      item: {
        programId,
        programName,
        workoutId: later.workoutId,
        workoutName: later.name,
        cycleNumber: later.cycleNumber,
      },
    };
  }
  const lastCycle = Math.max(...outline.workouts.map((w) => w.cycleNumber));
  if (outline.targetCycles === null) {
    const first = outline.workouts.find((w) => w.cycleNumber === lastCycle);
    return {
      kind: "new-cycle",
      programId,
      programName,
      cycleNumber: lastCycle + 1,
      workoutName: first?.name ?? null,
    };
  }
  if (lastCycle >= outline.targetCycles) {
    return { kind: "complete", programId, programName };
  }
  return { kind: "unknown", programId, programName };
}

/** A program whose next workout was resolved here, waiting on the server. */
export type Waiting = Exclude<Successor, { kind: "workout" }> & {
  programId: string;
  programName: string;
};

/**
 * What's next as this device sees it: each program's next from the server
 * (or the stored snapshot), moved past every workout resolved on this
 * device. A program whose successor only the server can mint (a new cycle)
 * or that has just finished is listed in `waiting` instead.
 */
export function deviceNext(
  next: readonly NextItem[],
  outlines: readonly ProgramOutline[],
  resolved: ReadonlySet<string>,
): { next: NextItem[]; waiting: Waiting[] } {
  const out: NextItem[] = [];
  const waiting: Waiting[] = [];
  for (const item of next) {
    if (!resolved.has(item.workoutId)) {
      out.push(item);
      continue;
    }
    const after = successorOf(outlines, item.workoutId, resolved);
    if (after.kind === "workout") {
      // The server's name is the fresher one (a rename since the outline).
      out.push({ ...after.item, programName: item.programName });
    } else {
      waiting.push({
        ...after,
        programId: item.programId,
        programName: item.programName,
      });
    }
  }
  return { next: out, waiting };
}
