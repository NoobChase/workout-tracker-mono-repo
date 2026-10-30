import { useQuery } from "@tanstack/react-query";
import { distanceUnit, weightUnit, workoutNode } from "@workout-tracker/shared";
import { useCallback, useEffect, useRef } from "react";
import { z } from "zod";
import { useDrafts } from "../../data/hooks.js";
import { keys } from "../../data/queries.js";
import { updates } from "../../boot/updates.js";
import type { BuilderModel } from "./reducer.js";
import type { BuilderState, CreateState, EditState } from "./tree.js";

/*
 * The builder's drafts on this device (design D14): the state as the lifter
 * left it, per program and cycle, written a beat after every edit and read
 * once when a builder opens. Stored versioned; a draft an older build wrote
 * no longer parses and is discarded (`DraftStore.get`), never half-read.
 */

/** Bump with any change to `BuilderState`'s shape. */
const DRAFT_VERSION = 1;

const setLine = z.object({
  id: z.string(),
  repsMin: z.number().nullable(),
  repsMax: z.number().nullable(),
  weight: z.number().nullable(),
  weightUnit: weightUnit.nullable(),
  effortKind: z.enum(["RIR", "RPE"]),
  effort: z.number().nullable(),
  keep: z.object({
    targetDurationSeconds: z.number().nullable(),
    targetDistance: z.number().nullable(),
    distanceUnit: distanceUnit.nullable(),
    notes: z.string().nullable(),
  }),
});

const slot = z.object({
  id: z.string(),
  exerciseId: z.string().nullable(),
  placeholderLabel: z.string().nullable(),
  targetSets: z.number().int(),
  groupKey: z.number().int().nullable(),
  notes: z.string().nullable(),
  perSet: z.boolean(),
  sets: z.array(setLine),
  storedPosition: z.number().int().nullable(),
});

const draftWorkout = z.object({
  id: z.string(),
  name: z.string(),
  notes: z.string().nullable(),
  slots: z.array(slot),
  storedPosition: z.number().int().nullable(),
  frozen: workoutNode.nullable(),
  trainedAt: z.string().nullable(),
});

const cycle = {
  programId: z.string(),
  cycleId: z.string(),
  cycleNumber: z.number().int(),
  workouts: z.array(draftWorkout),
};

const createState = z.object({
  mode: z.literal("create"),
  ...cycle,
  name: z.string(),
  length: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("fixed"), cycles: z.number().int() }),
    z.object({ kind: z.literal("open") }),
  ]),
}) satisfies z.ZodType<CreateState>;

const editState = z.object({
  mode: z.literal("edit"),
  ...cycle,
  baseline: z.string(),
  programName: z.string(),
}) satisfies z.ZodType<EditState>;

/** A stored draft: the state, versioned. */
const builderDraft = z.object({
  version: z.literal(DRAFT_VERSION),
  tree: z.discriminatedUnion("mode", [createState, editState]),
});

/**
 * The draft a builder opens with: the owner's for this program (`null`: a
 * new one) and cycle, or `null` when there is none. Read when the builder
 * opens, never from a cache (the builder writes drafts without telling
 * it), once someone owns the device's data (`useDrafts().userId`).
 */
export function useDraft(programId: string | null, cycleNumber: number) {
  const { drafts, userId } = useDrafts();
  return useQuery({
    queryKey: keys.draft(userId, programId, cycleNumber),
    queryFn: async (): Promise<BuilderState | null> => {
      if (userId === null) return null;
      const stored = await drafts
        .get(builderDraft, userId, programId, cycleNumber)
        .catch(() => undefined);
      return stored?.state.tree ?? null;
    },
    enabled: userId !== null,
    networkMode: "always",
    staleTime: Infinity,
    gcTime: 0,
  });
}

/**
 * Keeps the builder's state as the owner's draft (D14): every change lands
 * on the device a beat after it is made, and at once when the page is
 * hidden, the builder closes, or an update is about to reload the page. `forget` drops the draft (saved or
 * discarded), along with any write still waiting.
 */
export function useDraftAutosave(
  model: BuilderModel,
  owner: string,
  programId: string | null,
) {
  const { drafts } = useDrafts();
  const cycleNumber = model.tree.cycleNumber;
  const pending = useRef<BuilderState | null>(null);
  const flush = useCallback(() => {
    const tree = pending.current;
    pending.current = null;
    if (!tree) return;
    const write = drafts
      .put(owner, programId, cycleNumber, { version: DRAFT_VERSION, tree })
      .catch((e: unknown) => {
        console.warn("Keeping the draft on this device failed", e);
      });
    // An update that installs itself (design D18) reloads only once this
    // write has landed.
    updates.hold(write);
  }, [drafts, owner, programId, cycleNumber]);

  const { tree, dirty } = model;
  useEffect(() => {
    if (!dirty) return;
    pending.current = tree;
    const timer = setTimeout(flush, 250);
    return () => clearTimeout(timer);
  }, [tree, dirty, flush]);
  useEffect(() => {
    window.addEventListener("pagehide", flush);
    const offUpdate = updates.beforeUpdate(flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      offUpdate();
      flush();
    };
  }, [flush]);

  const forget = useCallback(() => {
    pending.current = null;
    return drafts.delete(owner, programId, cycleNumber);
  }, [drafts, owner, programId, cycleNumber]);
  return { forget };
}
