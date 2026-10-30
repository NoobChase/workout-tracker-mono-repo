import type { ProgramStatus, ProgramSummary } from "@workout-tracker/shared";
import { OfflineError } from "../api.js";
import { errorText, isNotEntitled } from "./errors.js";

/*
 * How a program reads on home and the Programs screen (spec
 * `program-lifecycle`): a fixed program's progress is "Cycle n of N", an
 * open-ended one's "Cycle n" with no total.
 */

export const STATUS_LABEL: Record<ProgramStatus, string> = {
  ACTIVE: "Active",
  DRAFT: "Draft",
  COMPLETED: "Finished",
  ARCHIVED: "Archived",
};

/** "Open-ended" or "12 cycles". */
export function lengthLabel(program: Pick<ProgramSummary, "targetCycles">) {
  const n = program.targetCycles;
  return n === null ? "Open-ended" : `${n} ${n === 1 ? "cycle" : "cycles"}`;
}

/**
 * Where the program stands, as numbers and words: `cycle` and `of` are set
 * in mono by the caller; `text` is the words-only form for a label.
 */
export function progressOf(program: ProgramSummary): {
  text: string;
  cycle: number | null;
  of: number | null;
} {
  const { status, currentCycle, targetCycles } = program;
  if (status === "DRAFT") return { text: "Not started", cycle: null, of: null };
  if (currentCycle === null) {
    return {
      text:
        targetCycles === null
          ? "Every cycle done"
          : `All ${targetCycles} ${targetCycles === 1 ? "cycle" : "cycles"} done`,
      cycle: null,
      of: null,
    };
  }
  return {
    text:
      targetCycles === null
        ? `Cycle ${currentCycle}`
        : `Cycle ${currentCycle} of ${targetCycles}`,
    cycle: currentCycle,
    of: targetCycles,
  };
}

/**
 * The name a copy gets unless the lifter types another: the server's rule
 * (operations.md 3.9), shown up front so they can change it in the same flow.
 */
export function suggestCopyName(
  name: string,
  taken: readonly string[],
): string {
  const names = new Set(taken);
  for (let n = 2; ; n++) {
    const candidate = `${name} (${n})`;
    if (!names.has(candidate)) return candidate;
  }
}

/** Words for a refused plan-side write ("programs" or "exercises"). */
export function programErrorText(
  error: unknown,
  what: "programs" | "exercises" = "programs",
): string {
  if (isNotEntitled(error)) {
    return `Changing ${what} needs an active subscription. Subscribing comes with billing; until then your programs and history stay readable, and export stays open.`;
  }
  if (error instanceof OfflineError) {
    return `Changing ${what} needs a connection. Try again once you're back online.`;
  }
  return errorText(error);
}

/** A program action that answers with the program as it now stands. */
export type ProgramAction = "activate" | "archive" | "extend";

/** The toast after `action` succeeded, from the program as it now stands. */
export function programActionToast(
  action: ProgramAction,
  now: ProgramSummary,
): { title: string; description: string } {
  switch (action) {
    case "activate":
      return {
        title: `${now.name} is active`,
        description:
          now.status === "COMPLETED"
            ? "Every workout in it was already done, so it’s finished."
            : "Its next workout is on home.",
      };
    case "archive":
      return {
        title: `${now.name} archived`,
        description: "Its history stays. Activate it to train it again.",
      };
    case "extend":
      return {
        title: `${now.name}: one more cycle`,
        description: `Cycle ${now.targetCycles ?? ""} repeats the last one. It’s active again.`,
      };
  }
}
