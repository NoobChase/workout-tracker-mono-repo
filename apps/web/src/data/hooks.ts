import {
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  CreateExerciseRequest,
  CreateProgramRequest,
  EditExerciseRequest,
  ExerciseListItem,
  ExercisesResponse,
  ProgramListResponse,
  SaveCycleRequest,
  UnitSettings,
} from "@workout-tracker/shared";
import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import type { LastUser } from "../local/db.js";
import {
  buildNextView,
  type DeviceNextView,
  type InProgressEntry,
  type ServerNext,
} from "../local/next-view.js";
import type { Successor } from "../local/outline.js";
import type { QueueState } from "../local/queue.js";
import { buildSessionView, type SessionView } from "../local/session-view.js";
import type { LocalSession } from "../local/sessions.js";
import {
  deriveRowSync,
  summarize,
  type SyncSummary,
} from "../local/sync-state.js";
import { withKeptId } from "./kept-id.js";
import { useDataLayer } from "./provider.js";
import { keys, refreshAfter, serverQueries } from "./queries.js";
import { summarizeQueue, type QueueSummary } from "./queue-summary.js";

/*
 * The hooks the screens use. Two kinds of data, never mixed (design D8):
 *
 * - The in-progress workout comes from the device: `useSessionRecord`,
 *   `useWorkoutActions`, `useSyncStatus`. Identical online and offline.
 * - Everything else is a server read through TanStack Query (`useNext`,
 *   `useTemplates`, `useHistory`, `useSessionDetail`, the plan reads), online
 *   only, except that `useNext` falls back to the last snapshot stored on
 *   the device. Keys, shared options and what each write refreshes live in
 *   `queries.ts`.
 */

export function useOnline(): boolean {
  const { connectivity } = useDataLayer();
  return useSyncExternalStore(connectivity.subscribe, connectivity.isOnline);
}

/** Clerk has loaded with a session, so server reads can carry a token. */
export function useAuthReady(): boolean {
  const { auth } = useDataLayer();
  return useSyncExternalStore(auth.subscribe, auth.isReady);
}

/** The last signed-in user on this device; `undefined` while it is read. */
export function useLastUser(): LastUser | null | undefined {
  const { lastUser } = useDataLayer();
  return useSyncExternalStore(lastUser.subscribe, lastUser.getSnapshot);
}

/**
 * Who owns this device's writes, cached plans and drafts right now
 * (`layer.userId()`: Clerk's signed-in user, else the last recorded one).
 * Re-reads when either changes; `null` until someone is known.
 */
export function useOwnerId(): string | null {
  const layer = useDataLayer();
  const subscribe = useCallback(
    (listener: () => void) => {
      const offAuth = layer.auth.subscribe(listener);
      const offUser = layer.lastUser.subscribe(listener);
      return () => {
        offAuth();
        offUser();
      };
    },
    [layer],
  );
  return useSyncExternalStore(subscribe, () => layer.userId());
}

export function useLocalSessions(): ReadonlyMap<string, LocalSession> {
  const { sessions } = useDataLayer();
  return useSyncExternalStore(sessions.subscribe, sessions.getSnapshot);
}

export function useQueueState(): QueueState {
  const { queue } = useDataLayer();
  return useSyncExternalStore(queue.subscribe, queue.getState);
}

export interface NextView extends DeviceNextView {
  /** Where `next` came from: the server now, or the device's last snapshot. */
  source: "server" | "device" | "none";
  isLoading: boolean;
  error: Error | null;
}

/**
 * What's next, plus the sessions to resume (`buildNextView`). Online, it
 * loads from the server, stores a snapshot and prefetches every listed
 * workout's context (design D9) and each program's outline; offline, it
 * shows the snapshot. Local sessions are merged in either way: a workout
 * started offline is offered for resumption, and one finished or skipped
 * here is replaced by the program's following workout before the write has
 * synced (step 4a D15).
 */
export function useNext(): NextView {
  const layer = useDataLayer();
  const ready = useAuthReady();
  const records = useLocalSessions();
  const userId = useOwnerId();

  const queryClient = useQueryClient();
  const server = useQuery({
    queryKey: keys.next(),
    queryFn: async (): Promise<ServerNext> => {
      const { next, prefetched } = await layer.loadNext();
      // Previews read the device cache; refresh them once it is filled.
      void prefetched.then(() =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: keys.contexts() }),
          queryClient.invalidateQueries({ queryKey: keys.outlines() }),
        ]),
      );
      return next;
    },
    enabled: ready,
  });
  const device = useQuery({
    queryKey: keys.deviceNext(userId),
    queryFn: () => (userId ? layer.contexts.readNext(userId) : null),
    enabled: userId !== null,
    networkMode: "always",
    staleTime: Infinity,
  });
  const outline = useQuery({
    queryKey: keys.outline(userId),
    queryFn: () => (userId ? layer.contexts.readOutline(userId) : []),
    enabled: userId !== null,
    networkMode: "always",
    staleTime: Infinity,
  });

  const view = useMemo(
    () =>
      buildNextView({
        server: server.data ?? null,
        device: device.data?.next ?? null,
        outlines: outline.data ?? [],
        records,
        userId,
        // Changes only together with `records`.
        settled: layer.sessions.settledWorkouts(),
      }),
    [layer, server.data, device.data, outline.data, records, userId],
  );
  const shown = server.data?.response ?? device.data?.next ?? null;
  return useMemo(
    () => ({
      ...view,
      source: server.data ? "server" : device.data ? "device" : "none",
      isLoading: shown === null && (server.isLoading || device.isLoading),
      error: server.data ? null : server.error,
    }),
    [
      view,
      shown,
      server.data,
      server.error,
      server.isLoading,
      device.data,
      device.isLoading,
    ],
  );
}

/**
 * The in-progress workout as the logger renders it: each planned exercise
 * beside its logged sets, every set with its sync state. `null` when this
 * device holds no record for the session.
 */
export function useSessionRecord(sessionId: string): SessionView | null {
  const records = useLocalSessions();
  const queue = useQueueState();
  const online = useOnline();
  const record = records.get(sessionId);
  const rows = useMemo(
    () => deriveRowSync(queue.items, online),
    [queue.items, online],
  );
  return useMemo(
    () => (record ? buildSessionView(record, rows) : null),
    [record, rows],
  );
}

/**
 * The always-visible sync line, and the one action a rejection allows.
 * `pending` counts raw writes; `queued` says it in sets (and whether the
 * workout's own start or finish is waiting), and names the blocked write.
 */
export function useSyncStatus(): SyncSummary & {
  queued: QueueSummary;
  retry: () => Promise<void>;
} {
  const layer = useDataLayer();
  const queue = useQueueState();
  const online = useOnline();
  return useMemo(
    () => ({
      ...summarize(queue, online),
      queued: summarizeQueue(queue.items),
      retry: () => layer.queue.retryRejected(),
    }),
    [queue, online, layer],
  );
}

/**
 * A workout's plan as this device has it cached (design D9 prefetch), for
 * previews on home. Device only, so it works offline; `null` when the
 * workout was never prefetched.
 */
export function useWorkoutPreview(workoutId: string) {
  const layer = useDataLayer();
  return useQuery({
    queryKey: keys.context(workoutId),
    queryFn: async () => (await layer.contexts.get(workoutId))?.context ?? null,
    networkMode: "always",
    staleTime: Infinity,
  });
}

/**
 * The logger's operations. Each updates the local record and queues its
 * write in one step, so it returns as soon as IndexedDB commits, online or
 * not. Ids and timestamps are minted on the device.
 */
export function useWorkoutActions() {
  const layer = useDataLayer();
  return useMemo(
    () => ({
      start: (workoutId: string) => layer.sessions.start(workoutId),
      logSet: (
        sessionId: string,
        input: { plannedExerciseId: string; reps: number; weight: number },
      ) => layer.sessions.logSet(sessionId, input),
      editSet: (
        sessionId: string,
        setId: string,
        input: { reps: number; weight: number },
      ) => layer.sessions.editSet(sessionId, setId, input),
      deleteSet: (sessionId: string, setId: string) =>
        layer.sessions.deleteSet(sessionId, setId),
      finish: (sessionId: string) => layer.sessions.finish(sessionId),
      /** Skip a workout before it starts: a queued write, works offline. */
      skip: (workoutId: string) => layer.sessions.skip(workoutId),
      /** Bring a session started elsewhere here (`DataLayer.ensureOnDevice`). */
      ensureOnDevice: (
        entry: Pick<InProgressEntry, "sessionId" | "workoutId">,
      ) => layer.ensureOnDevice(entry),
    }),
    [layer],
  );
}

/**
 * "Finish & start next" (`DataLayer.finishAndStartNext`), rereading what's
 * next through the query cache when the server must name the next workout.
 */
export function useFinishAndStartNext() {
  const layer = useDataLayer();
  const queryClient = useQueryClient();
  return useCallback(
    (entry: InProgressEntry, after: Successor) =>
      layer.finishAndStartNext(entry, after, async () => {
        await queryClient.invalidateQueries({
          queryKey: keys.next(),
          exact: true,
        });
        return queryClient.getQueryData<ServerNext>(keys.next())?.response;
      }),
    [layer, queryClient],
  );
}

/** The program list as the home and Programs screens read it. */
export type ProgramList = ProgramListResponse["programs"];

/**
 * Every program the user owns, whatever its status, with its progress
 * (design D10). A server read: offline it shows what was last loaded.
 */
export function usePrograms() {
  const layer = useDataLayer();
  const ready = useAuthReady();
  return useQuery({ ...serverQueries.programs(layer.api), enabled: ready });
}

/**
 * The program lifecycle (operations.md 3.9-3.12, 3.14). Plan-side, so online
 * only and never queued: plain mutations. Copy and extend keep their minted
 * id until the call succeeds (`withKeptId`). Each success refreshes what it
 * changed (`AFFECTS`).
 */
export function useProgramActions() {
  const layer = useDataLayer();
  const queryClient = useQueryClient();
  const copyIds = useRef(new Map<string, string>());
  const extendIds = useRef(new Map<string, string>());
  const rename = useMutation({
    mutationFn: (input: { programId: string; name: string }) =>
      layer.api.renameProgram(input.programId, { name: input.name }),
    onSuccess: () => refreshAfter(queryClient, "renameProgram"),
  });
  const copy = useMutation({
    mutationFn: (input: { programId: string; name?: string }) =>
      withKeptId(
        copyIds.current,
        JSON.stringify([input.programId, input.name ?? null]),
        (newProgramId) =>
          layer.api.copyProgram(input.programId, {
            newProgramId,
            name: input.name,
          }),
      ),
    onSuccess: () => refreshAfter(queryClient, "copyProgram"),
  });
  const activate = useMutation({
    mutationFn: (programId: string) => layer.api.activateProgram(programId),
    onSuccess: () => refreshAfter(queryClient, "activateProgram"),
  });
  const archive = useMutation({
    mutationFn: (programId: string) => layer.api.archiveProgram(programId),
    onSuccess: () => refreshAfter(queryClient, "archiveProgram"),
  });
  const extend = useMutation({
    mutationFn: (programId: string) =>
      withKeptId(extendIds.current, programId, (newPlanId) =>
        layer.api.extendProgram(programId, { newPlanId }),
      ),
    onSuccess: () => refreshAfter(queryClient, "extendProgram"),
  });
  return { rename, copy, activate, archive, extend };
}

export function useTemplates() {
  const layer = useDataLayer();
  const ready = useAuthReady();
  return useQuery({
    queryKey: keys.templates(),
    queryFn: () => layer.api.templates(),
    enabled: ready,
    staleTime: Infinity,
  });
}

/**
 * Starts a program from a template. Plan-side and online only (operations.md
 * §0.3), so it is a plain mutation, not a queued write. The program id is
 * still minted here and kept until the start succeeds, so a lifter tapping
 * again after a lost response gets the same program, not a second one.
 */
export function useStartProgram() {
  const layer = useDataLayer();
  const queryClient = useQueryClient();
  const programIds = useRef(new Map<string, string>());
  return useMutation({
    mutationFn: (templateSlug: string) =>
      withKeptId(programIds.current, templateSlug, (programId) =>
        layer.api.startFromTemplate({ programId, templateSlug }),
      ),
    onSuccess: () => refreshAfter(queryClient, "startProgram"),
  });
}

/** Completed sessions, newest first, a page at a time. */
export function useHistory() {
  const layer = useDataLayer();
  const ready = useAuthReady();
  return useInfiniteQuery({
    queryKey: keys.history(),
    queryFn: ({ pageParam }) => layer.api.history(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: ready,
  });
}

/** One session with every set as logged, skipped exercises included. */
export function useSessionDetail(sessionId: string) {
  const layer = useDataLayer();
  const ready = useAuthReady();
  return useQuery({
    queryKey: keys.session(sessionId),
    queryFn: () => layer.api.session(sessionId),
    enabled: ready,
  });
}

// --- Plan-side reads and writes for the builder and catalog (step 4a) -------

/** One program with its cycles, each flagged if trained (design D10). */
export function useProgram(programId: string | undefined) {
  const layer = useDataLayer();
  const ready = useAuthReady();
  return useQuery({
    ...serverQueries.program(layer.api, programId),
    enabled: ready,
  });
}

/**
 * One cycle's tree, each workout flagged if trained (D5, D10), with the
 * fingerprint read in the same snapshot (D17). `fresh`: the builder's read,
 * refetched on every mount, so an editor never seeds from a tree another
 * screen cached (wait for `isFetchedAfterMount`).
 */
export function useCycle(
  programId: string | undefined,
  cycleNumber: number,
  { fresh = false }: { fresh?: boolean } = {},
) {
  const layer = useDataLayer();
  const ready = useAuthReady();
  return useQuery({
    ...serverQueries.cycle(layer.api, programId, cycleNumber),
    enabled: ready,
    ...(fresh ? { staleTime: 0, refetchOnMount: "always" as const } : {}),
  });
}

/** Several cycles' trees at once (the program page's workout counts). */
export function useCycles(
  programId: string | undefined,
  cycleNumbers: readonly number[],
) {
  const layer = useDataLayer();
  const ready = useAuthReady();
  return useQueries({
    queries: cycleNumbers.map((n) => ({
      ...serverQueries.cycle(layer.api, programId, n),
      enabled: ready,
    })),
  });
}

/**
 * The apply preview (D7): a cycle's fingerprint and every later cycle's
 * status against it. Never stale-cached: the save rereads it.
 */
export function useApplyPreview(
  programId: string | undefined,
  cycleNumber: number,
) {
  const layer = useDataLayer();
  const ready = useAuthReady();
  return useQuery({
    ...serverQueries.applyPreview(layer.api, programId, cycleNumber),
    enabled: ready,
  });
}

/**
 * Which cycles differ from cycle 1 (the ◆ markers), from cycle 1's apply
 * preview; `known` once it has loaded. The builder's strip and the program
 * page both read it.
 */
export function useCycleDifferences(programId: string | undefined): {
  known: boolean;
  different: ReadonlySet<number>;
} {
  const first = useApplyPreview(programId, 1);
  return useMemo(
    () => ({
      known: first.data !== undefined,
      different: new Set(
        (first.data?.later ?? [])
          .filter((c) => !c.matches)
          .map((c) => c.cycleNumber),
      ),
    }),
    [first.data],
  );
}

const LB_ONLY: UnitSettings = { default: "LB", overrides: {} };

/**
 * The user's weight units for the builder (default and per-exercise
 * overrides), from the exercise catalog read (`GET /exercises` carries them).
 * When the catalog can't be read (offline, Clerk not loaded, or the read
 * failed), the newest cached workout context stands in, else lb (a US
 * product). `undefined` only while the catalog is on its way.
 */
export function useUnits(): UnitSettings | undefined {
  const layer = useDataLayer();
  const userId = useOwnerId();
  const online = useOnline();
  const ready = useAuthReady();
  const catalog = useExercises();
  const unreadable = !catalog.data && (!online || !ready || catalog.isError);
  const cached = useQuery({
    queryKey: keys.cachedUnits(userId),
    queryFn: async () =>
      (userId ? await layer.contexts.units(userId) : null) ?? LB_ONLY,
    enabled: unreadable,
    networkMode: "always",
    staleTime: Infinity,
  });
  return catalog.data?.units ?? (unreadable ? cached.data : undefined);
}

/**
 * The builder's drafts on this device (D14), for whoever owns this device's
 * data; `userId` is `null` until someone is known, and a screen reading a
 * draft waits for it rather than starting blank over one.
 */
export function useDrafts() {
  const layer = useDataLayer();
  const userId = useOwnerId();
  return { drafts: layer.drafts, userId };
}

/**
 * Create a program from its first cycle (operations.md 3.1; D3). The request
 * carries ids minted when the builder opened, kept in the draft, so a retry
 * after a lost response is the same program, never a second one.
 */
export function useCreateProgram() {
  const layer = useDataLayer();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateProgramRequest) =>
      layer.api.createProgram(request),
    onSuccess: () => refreshAfter(queryClient, "createProgram"),
  });
}

/** Save one cycle, and apply it to the chosen later cycles (3.7, 3.8; D4, D7). */
export function useSaveCycle() {
  const layer = useDataLayer();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      programId: string;
      cycleNumber: number;
      request: SaveCycleRequest;
    }) =>
      layer.api.saveCycle(input.programId, input.cycleNumber, input.request),
    onSuccess: () => refreshAfter(queryClient, "saveCycle"),
  });
}

/**
 * The exercise catalog (D11): every exercise the user can see, their own
 * retired ones included, fetched whole and filtered on the device.
 */
export function useExercises() {
  const layer = useDataLayer();
  const ready = useAuthReady();
  return useQuery({
    queryKey: keys.exercises(),
    queryFn: () => layer.api.exercises(),
    enabled: ready,
    staleTime: 5 * 60_000,
  });
}

/**
 * Each user's exercise create still waiting for a successful answer, by
 * owner: its minted id (`withKeptId`). Module level, so the id outlives the
 * form: a lost answer, then the lifter editing the name, closing the sheet
 * and creating again, is still one exercise. Dropped on success, or once a
 * catalog read lists it.
 */
const pendingCreates = new Map<string, string>();

/** What `wanted` changes on `stored`, as an edit; `null` when nothing. */
function changesFrom(
  stored: ExerciseListItem,
  wanted: Omit<CreateExerciseRequest, "id">,
): EditExerciseRequest | null {
  const same = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && [...a].sort().join() === [...b].sort().join();
  const patch: EditExerciseRequest = {};
  if (stored.name !== wanted.name) patch.name = wanted.name;
  if (
    !same(stored.primaryMuscles, wanted.primaryMuscles) ||
    !same(stored.secondaryMuscles, wanted.secondaryMuscles)
  ) {
    patch.primaryMuscles = wanted.primaryMuscles;
    patch.secondaryMuscles = wanted.secondaryMuscles;
  }
  if (stored.equipment !== wanted.equipment) patch.equipment = wanted.equipment;
  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Catalog writes (operations.md 2.2-2.5). Online only. Create and notes keep
 * their minted ids until the call succeeds (`withKeptId`; create's per user
 * across edits and remounts, `pendingCreates`). Each answer replaces the row
 * in the cached list, so every screen shows it at once.
 */
export function useExerciseActions() {
  const layer = useDataLayer();
  const queryClient = useQueryClient();
  const notesIds = useRef(new Map<string, string>());
  const put = useCallback(
    ({ exercise }: { exercise: ExerciseListItem }) => {
      queryClient.setQueryData<ExercisesResponse>(keys.exercises(), (old) => {
        if (!old) return old;
        const rest = old.exercises.filter((e) => e.id !== exercise.id);
        return {
          ...old,
          exercises: [...rest, exercise].sort((a, b) =>
            a.name.localeCompare(b.name),
          ),
        };
      });
      return refreshAfter(queryClient, "exercise");
    },
    [queryClient],
  );
  const create = useMutation({
    mutationFn: async (input: Omit<CreateExerciseRequest, "id">) => {
      const owner = layer.userId() ?? "";
      const listed = queryClient
        .getQueryData<ExercisesResponse>(keys.exercises())
        ?.exercises.some((e) => e.id === pendingCreates.get(owner));
      // Already in a catalog read: that create landed and the lifter has
      // seen it, so this is another exercise.
      if (listed) pendingCreates.delete(owner);
      const result = await withKeptId(pendingCreates, owner, (id) =>
        layer.api.createExercise({ ...input, id }),
      );
      // A retry after a lost answer finds the exercise as first sent; the
      // lifter's edits since then are applied to it, not made a second one.
      const patch = changesFrom(result.exercise, input);
      return patch ? layer.api.editExercise(result.exercise.id, patch) : result;
    },
    onSuccess: put,
  });
  const edit = useMutation({
    mutationFn: (input: { exerciseId: string; patch: EditExerciseRequest }) =>
      layer.api.editExercise(input.exerciseId, input.patch),
    onSuccess: put,
  });
  const notes = useMutation({
    mutationFn: (input: {
      exerciseId: string;
      setup: string | null;
      cues: string | null;
    }) =>
      withKeptId(notesIds.current, input.exerciseId, (id) =>
        layer.api.saveExerciseNotes(input.exerciseId, {
          id,
          setup: input.setup,
          cues: input.cues,
        }),
      ),
    onSuccess: put,
  });
  const retire = useMutation({
    mutationFn: (exerciseId: string) => layer.api.retireExercise(exerciseId),
    onSuccess: put,
  });
  const reactivate = useMutation({
    mutationFn: (exerciseId: string) =>
      layer.api.reactivateExercise(exerciseId),
    onSuccess: put,
  });
  return { create, edit, notes, retire, reactivate };
}
