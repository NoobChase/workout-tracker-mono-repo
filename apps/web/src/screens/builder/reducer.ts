import {
  newId,
  type CycleDetailResponse,
  type WeightUnit,
} from "@workout-tracker/shared";
import {
  addSlot,
  addWorkout,
  DEFAULT_TARGET_SETS,
  moveSlot,
  moveWorkout,
  rebase,
  removeSlot,
  removeWorkout,
  renameWorkout,
  replaceSlot,
  setPerSet,
  setSlotNotes,
  setTargetSets,
  setWorkoutNotes,
  supersetWithNext,
  targetSetCount,
  ungroup,
  updateLine,
  type BuilderState,
  type EditState,
  type LinePatch,
  type ProgramLength,
  type SlotChoice,
} from "./tree.js";

/*
 * The builder's state and every change to it, as one reducer over `tree.ts`
 * (brief `apps-web-src-builder`). An edit marks the cycle dirty in the same
 * step, so the two never disagree. Ids for new rows are minted by the action
 * creators below, never inside the reducer, so it stays pure (React may run
 * it twice) and a replayed action makes the same rows.
 */

export interface BuilderModel<S extends BuilderState = BuilderState> {
  tree: S;
  /** Changed since it was loaded or saved: kept as a draft, saveable. */
  dirty: boolean;
}

export type BuilderAction =
  // A new program's own fields; ignored when editing a cycle.
  | { type: "set-name"; name: string }
  | { type: "set-length"; length: ProgramLength }
  // Workouts
  | { type: "add-workout"; id: string }
  | { type: "rename-workout"; wi: number; name: string }
  | { type: "workout-notes"; wi: number; notes: string | null }
  | { type: "move-workout"; wi: number; direction: -1 | 1 }
  | { type: "remove-workout"; wi: number }
  // Slots
  | {
      type: "add-slot";
      wi: number;
      choice: SlotChoice;
      slotId: string;
      lineIds: readonly string[];
    }
  | { type: "replace-slot"; wi: number; si: number; choice: SlotChoice }
  | {
      type: "set-target-sets";
      wi: number;
      si: number;
      count: number;
      lineIds: readonly string[];
    }
  | { type: "per-set"; wi: number; si: number; perSet: boolean }
  | {
      type: "update-line";
      wi: number;
      si: number;
      line: number | "all";
      patch: LinePatch;
      /** The slot exercise's unit, for a newly typed weight. */
      unit: WeightUnit;
    }
  | { type: "slot-notes"; wi: number; si: number; notes: string | null }
  | { type: "move-slot"; wi: number; from: number; to: number }
  | { type: "remove-slot"; wi: number; si: number }
  | { type: "superset-with-next"; wi: number; si: number }
  | { type: "ungroup"; wi: number; si: number }
  // Whole states
  /** After a stale refusal: rebased on a fresh read; editing a cycle only. */
  | { type: "rebase"; cycle: CycleDetailResponse }
  /** Undo: an earlier state back, as unsaved work. */
  | { type: "restore"; tree: BuilderState }
  /** Discard: the saved state, nothing unsaved. */
  | { type: "reset"; tree: BuilderState }
  /** Saved as it stands: nothing unsaved. */
  | { type: "saved" };

/** The action creators that mint ids. */
export const mintingActions = {
  addWorkout: (): BuilderAction => ({ type: "add-workout", id: newId() }),
  addSlot: (wi: number, choice: SlotChoice) =>
    ({
      type: "add-slot",
      wi,
      choice,
      slotId: newId(),
      lineIds: Array.from({ length: DEFAULT_TARGET_SETS }, () => newId()),
    }) satisfies BuilderAction,
  setTargetSets: (wi: number, si: number, count: number): BuilderAction => ({
    type: "set-target-sets",
    wi,
    si,
    count,
    lineIds: Array.from({ length: targetSetCount(count) }, () => newId()),
  }),
};

function edit<S extends BuilderState>(tree: S, action: BuilderAction): S {
  switch (action.type) {
    case "set-name":
      return tree.mode === "create" ? { ...tree, name: action.name } : tree;
    case "set-length":
      return tree.mode === "create" ? { ...tree, length: action.length } : tree;
    case "add-workout":
      return addWorkout(tree, action.id);
    case "rename-workout":
      return renameWorkout(tree, action.wi, action.name);
    case "workout-notes":
      return setWorkoutNotes(tree, action.wi, action.notes);
    case "move-workout":
      return moveWorkout(tree, action.wi, action.direction);
    case "remove-workout":
      return removeWorkout(tree, action.wi);
    case "add-slot":
      return addSlot(tree, action.wi, action.choice, {
        slot: action.slotId,
        lines: action.lineIds,
      });
    case "replace-slot":
      return replaceSlot(tree, action.wi, action.si, action.choice);
    case "set-target-sets":
      return setTargetSets(
        tree,
        action.wi,
        action.si,
        action.count,
        action.lineIds,
      );
    case "per-set":
      return setPerSet(tree, action.wi, action.si, action.perSet);
    case "update-line":
      return updateLine(
        tree,
        action.wi,
        action.si,
        action.line,
        action.patch,
        action.unit,
      );
    case "slot-notes":
      return setSlotNotes(tree, action.wi, action.si, action.notes);
    case "move-slot":
      return moveSlot(tree, action.wi, action.from, action.to);
    case "remove-slot":
      return removeSlot(tree, action.wi, action.si);
    case "superset-with-next":
      return supersetWithNext(tree, action.wi, action.si);
    case "ungroup":
      return ungroup(tree, action.wi, action.si);
    case "rebase":
      // Narrowing by the tag drops `S`; it is still this builder's state.
      return tree.mode === "edit"
        ? rebase(tree as S & EditState, action.cycle)
        : tree;
    case "restore":
    case "reset":
    case "saved":
      return tree;
  }
}

export function builderReducer<S extends BuilderState>(
  model: BuilderModel<S>,
  action: BuilderAction,
): BuilderModel<S> {
  if (action.type === "saved") return { ...model, dirty: false };
  if (action.type === "restore" || action.type === "reset") {
    // The same kind of state comes back: a builder only ever holds one.
    if (action.tree.mode !== model.tree.mode) return model;
    return { tree: action.tree as S, dirty: action.type === "restore" };
  }
  const tree = edit(model.tree, action);
  return tree === model.tree ? model : { tree, dirty: true };
}
