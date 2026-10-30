import {
  queryOptions,
  skipToken,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import type { ServerApi } from "../local/layer.js";
import type { QueueOp } from "../local/queue.js";

/*
 * The server reads' cache, in one place: every query key (`keys`), the
 * options each server read is made with (`serverQueries`, shared by the hooks
 * and by anything that refetches one by hand), and what every write makes
 * stale (`AFFECTS`), used by each mutation's `onSuccess` and by the queue's
 * ack listener alike, so a write can't refresh one screen and forget another.
 */

export const keys = {
  /** What's next from the server; as a prefix, the device snapshot too. */
  next: () => ["next"] as const,
  deviceNext: (userId: string | null) => ["next", "device", userId] as const,
  outlines: () => ["outline"] as const,
  outline: (userId: string | null) => ["outline", userId] as const,
  contexts: () => ["context"] as const,
  context: (workoutId: string) => ["context", workoutId] as const,
  templates: () => ["templates"] as const,
  programs: () => ["programs"] as const,
  programDetails: () => ["program"] as const,
  program: (programId: string | undefined) => ["program", programId] as const,
  cycles: () => ["cycle"] as const,
  cycle: (programId: string | undefined, cycleNumber: number) =>
    ["cycle", programId, cycleNumber] as const,
  applyPreviews: () => ["apply-preview"] as const,
  applyPreview: (programId: string | undefined, cycleNumber: number) =>
    ["apply-preview", programId, cycleNumber] as const,
  history: () => ["history"] as const,
  session: (sessionId: string) => ["session", sessionId] as const,
  exercises: () => ["exercises"] as const,
  cachedUnits: (userId: string | null) => ["cached-units", userId] as const,
  draft: (
    userId: string | null,
    programId: string | null,
    cycleNumber: number,
  ) => ["draft", userId, programId, cycleNumber] as const,
};

/**
 * The server reads that more than one caller makes: the hooks add when they
 * may run (`enabled`), and a save or reload refetches through the same
 * options. A missing program id skips the read (`skipToken`).
 */
export const serverQueries = {
  programs: (api: ServerApi) =>
    queryOptions({
      queryKey: keys.programs(),
      queryFn: () => api.programs(),
    }),
  program: (api: ServerApi, programId: string | undefined) =>
    queryOptions({
      queryKey: keys.program(programId),
      queryFn:
        programId === undefined ? skipToken : () => api.program(programId),
    }),
  cycle: (api: ServerApi, programId: string | undefined, cycleNumber: number) =>
    queryOptions({
      queryKey: keys.cycle(programId, cycleNumber),
      queryFn:
        programId === undefined
          ? skipToken
          : () => api.cycle(programId, cycleNumber),
    }),
  /** Never stale-cached: a save rereads it. */
  applyPreview: (
    api: ServerApi,
    programId: string | undefined,
    cycleNumber: number,
  ) =>
    queryOptions({
      queryKey: keys.applyPreview(programId, cycleNumber),
      queryFn:
        programId === undefined
          ? skipToken
          : () => api.applyPreview(programId, cycleNumber),
      staleTime: 0,
    }),
};

/** A cycle as the server has it now, never the cache's (D17). */
export function rereadCycle(
  queryClient: QueryClient,
  api: ServerApi,
  programId: string,
  cycleNumber: number,
) {
  return queryClient.fetchQuery({
    ...serverQueries.cycle(api, programId, cycleNumber),
    staleTime: 0,
  });
}

/** The apply preview as the server has it now, for the save's confirmation. */
export function rereadApplyPreview(
  queryClient: QueryClient,
  api: ServerApi,
  programId: string,
  cycleNumber: number,
) {
  return queryClient.fetchQuery(
    serverQueries.applyPreview(api, programId, cycleNumber),
  );
}

// --- What a write changes ----------------------------------------------------

/** The cached reads a write can make stale, each a key prefix. */
const AREA = {
  next: keys.next(),
  outline: keys.outlines(),
  programs: keys.programs(),
  program: keys.programDetails(),
  cycle: keys.cycles(),
  applyPreview: keys.applyPreviews(),
  history: keys.history(),
  exercises: keys.exercises(),
} satisfies Record<string, QueryKey>;

type Area = keyof typeof AREA;

/** Every read about the plan: a program's progress, its cycles, what's next. */
const PLAN = [
  "programs",
  "program",
  "cycle",
  "applyPreview",
  "next",
  "outline",
] as const satisfies readonly Area[];

/**
 * What each write makes stale. Plan-side writes run as mutations; the queued
 * logging writes count once delivered (`DataProvider`), and each of those
 * also refreshes its own session.
 *
 * - A program's lifecycle changes its summary and detail, what's next and,
 *   through its name, history.
 * - A delivered start trains its workout (design D5): the program's and its
 *   cycle's trained flags, the outline and the apply preview change with it.
 * - A delivered finish or skip resolves a workout: it can roll a program
 *   over or complete it, and a finish lands in history.
 */
export const AFFECTS = {
  renameProgram: [...PLAN, "history"],
  copyProgram: [...PLAN, "history"],
  activateProgram: [...PLAN, "history"],
  archiveProgram: [...PLAN, "history"],
  extendProgram: [...PLAN, "history"],
  startProgram: ["next", "programs"],
  createProgram: PLAN,
  saveCycle: PLAN,
  exercise: ["exercises"],
  start: ["next", "program", "cycle", "applyPreview", "outline"],
  finish: [...PLAN, "history"],
  skip: PLAN,
  log: [],
  edit: [],
  delete: [],
} as const satisfies Record<string, readonly Area[]> &
  Record<QueueOp, readonly Area[]>;

export type Write = keyof typeof AFFECTS;

/** Marks everything `write` changed as stale; what's on screen refetches. */
export function refreshAfter(
  queryClient: QueryClient,
  write: Write,
): Promise<unknown> {
  return Promise.all(
    AFFECTS[write].map((area: Area) =>
      queryClient.invalidateQueries({ queryKey: AREA[area] }),
    ),
  );
}
