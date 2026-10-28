import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { newId, type WhatsNextResponse } from "@workout-tracker/shared";
import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import type { LastUser } from "../local/db.js";
import type { QueueState } from "../local/queue.js";
import { summarizeQueue, type QueueSummary } from "./queue-summary.js";
import { buildSessionView, type SessionView } from "../local/session-view.js";
import type { LocalSession } from "../local/sessions.js";
import {
  deriveRowSync,
  summarize,
  type SyncSummary,
} from "../local/sync-state.js";
import { useDataLayer } from "./provider.js";

/*
 * The hooks the screens use. Two kinds of data, never mixed (design D8):
 *
 * - The in-progress workout comes from the device: `useSessionRecord`,
 *   `useWorkoutActions`, `useSyncStatus`. Identical online and offline.
 * - Everything else is a server read through TanStack Query (`useNext`,
 *   `useTemplates`, `useHistory`, `useSessionDetail`), online only, except
 *   that `useNext` falls back to the last snapshot stored on the device.
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
 * Who owns this device's writes and cached plans right now (`layer.userId()`:
 * Clerk's signed-in user, else the last recorded one). Re-reads when either
 * changes.
 */
function useOwnerId(): string | null {
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

export interface InProgressEntry {
  sessionId: string;
  workoutId: string;
  workoutName: string;
  programName: string;
  performedAt: string;
  /** False: started elsewhere; resuming needs `useWorkoutActions().adopt`. */
  onDevice: boolean;
}

export interface NextView {
  /** One workout per active program. */
  next: WhatsNextResponse["next"];
  /** Sessions to offer for resumption, this device's first. */
  inProgress: InProgressEntry[];
  /** Where `next` came from: the server now, or the device's last snapshot. */
  source: "server" | "device" | "none";
  isLoading: boolean;
  error: Error | null;
}

/**
 * What's next, plus the sessions to resume. Online, it loads from the server,
 * stores a snapshot and prefetches every listed workout's context (design
 * D9); offline, it shows the snapshot. Local sessions are merged in either
 * way, so a workout started offline is offered for resumption, and one
 * finished offline stops being listed before its finish has synced.
 */
export function useNext(): NextView {
  const layer = useDataLayer();
  const ready = useAuthReady();
  const records = useLocalSessions();
  const userId = useOwnerId();

  const queryClient = useQueryClient();
  const server = useQuery({
    queryKey: ["next"],
    queryFn: async () => {
      const { next, prefetched } = await layer.loadNext();
      // Previews read the device cache; refresh them once it is filled.
      void prefetched.then(() =>
        queryClient.invalidateQueries({ queryKey: ["context"] }),
      );
      return next;
    },
    enabled: ready,
  });
  const device = useQuery({
    queryKey: ["next", "device", userId],
    queryFn: () => (userId ? layer.contexts.readNext(userId) : null),
    enabled: userId !== null,
    networkMode: "always",
    staleTime: Infinity,
  });

  return useMemo(() => {
    const data = server.data ?? device.data?.next ?? null;
    const mine = [...records.values()].filter((r) => r.userId === userId);
    const finished = new Set(
      mine.filter((r) => r.status === "FINISHED").map((r) => r.sessionId),
    );
    const finishedWorkouts = new Set(
      mine.filter((r) => r.status === "FINISHED").map((r) => r.workoutId),
    );
    const local: InProgressEntry[] = mine
      .filter((r) => r.status === "IN_PROGRESS")
      .map((r) => ({
        sessionId: r.sessionId,
        workoutId: r.workoutId,
        workoutName: r.context.workout.name,
        programName: r.context.workout.programName,
        performedAt: r.performedAt,
        onDevice: true,
      }));
    const remote: InProgressEntry[] = (data?.inProgress ?? [])
      .filter((s) => !records.has(s.sessionId) && !finished.has(s.sessionId))
      .map((s) => ({ ...s, onDevice: false }));
    return {
      next: (data?.next ?? []).filter(
        (n) => !finishedWorkouts.has(n.workoutId),
      ),
      inProgress: [...local, ...remote],
      source: server.data ? "server" : device.data ? "device" : "none",
      isLoading: data === null && (server.isLoading || device.isLoading),
      error: server.data ? null : server.error,
    };
  }, [
    server.data,
    server.error,
    server.isLoading,
    device.data,
    device.isLoading,
    records,
    userId,
  ]);
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
    queryKey: ["context", workoutId],
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
      /** Resume a session started elsewhere (online; see `SessionStore.adopt`). */
      adopt: async (entry: { sessionId: string; workoutId: string }) => {
        const [detail, context] = await Promise.all([
          layer.api.session(entry.sessionId),
          layer.contexts.ensure(entry.workoutId, layer.userId()),
        ]);
        await layer.sessions.adopt(detail, context);
      },
    }),
    [layer],
  );
}

export function useTemplates() {
  const layer = useDataLayer();
  const ready = useAuthReady();
  return useQuery({
    queryKey: ["templates"],
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
  const pending = useRef<{ slug: string; programId: string } | null>(null);
  return useMutation({
    mutationFn: (templateSlug: string) => {
      if (pending.current?.slug !== templateSlug) {
        pending.current = { slug: templateSlug, programId: newId() };
      }
      return layer.api.startFromTemplate({
        programId: pending.current.programId,
        templateSlug,
      });
    },
    onSuccess: () => {
      pending.current = null;
      return queryClient.invalidateQueries({ queryKey: ["next"] });
    },
  });
}

/** Completed sessions, newest first, a page at a time. */
export function useHistory() {
  const layer = useDataLayer();
  const ready = useAuthReady();
  return useInfiniteQuery({
    queryKey: ["history"],
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
    queryKey: ["session", sessionId],
    queryFn: () => layer.api.session(sessionId),
    enabled: ready,
  });
}
