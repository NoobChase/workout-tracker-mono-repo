import { newId } from "@workout-tracker/shared";
import { describe, expect, it } from "vitest";
import {
  builderReducer,
  mintingActions,
  type BuilderModel,
} from "./reducer.js";
import { MAX_TARGET_SETS, newProgram, type CreateState } from "./tree.js";

const clean = (): BuilderModel<CreateState> => ({
  tree: newProgram(newId),
  dirty: false,
});

describe("builderReducer", () => {
  it("marks the cycle dirty in the same step as the edit, and never for a no-op", () => {
    const start = clean();
    const renamed = builderReducer(start, {
      type: "rename-workout",
      wi: 0,
      name: "Push",
    });
    expect(renamed.dirty).toBe(true);
    expect(renamed.tree.workouts[0]!.name).toBe("Push");
    // No workout 5: nothing changes, and nothing is marked.
    expect(
      builderReducer(start, { type: "rename-workout", wi: 5, name: "x" }),
    ).toBe(start);
  });

  it("is pure: the ids come in the action, so replaying it makes the same rows", () => {
    const add = mintingActions.addSlot(0, { exerciseId: newId() });
    const once = builderReducer(clean(), add);
    const again = builderReducer(clean(), add);
    expect(once.tree.workouts[0]!.slots).toEqual(again.tree.workouts[0]!.slots);
    expect(once.tree.workouts[0]!.slots[0]!.id).toBe(add.slotId);
    expect(once.tree.workouts[0]!.slots[0]!.sets.map((l) => l.id)).toEqual(
      add.lineIds,
    );
  });

  it("grows a slot with the action's ids, capped at the most sets a slot takes", () => {
    let model = builderReducer(
      clean(),
      mintingActions.addSlot(0, { exerciseId: newId() }),
    );
    model = builderReducer(model, mintingActions.setTargetSets(0, 0, 999));
    const slot = model.tree.workouts[0]!.slots[0]!;
    expect(slot.targetSets).toBe(MAX_TARGET_SETS);
    expect(slot.sets).toHaveLength(MAX_TARGET_SETS);
    expect(new Set(slot.sets.map((l) => l.id)).size).toBe(MAX_TARGET_SETS);
  });

  it("a new program's name changes it; an edited cycle ignores it", () => {
    const named = builderReducer(clean(), { type: "set-name", name: "Base" });
    expect(named.tree.name).toBe("Base");
    expect(named.dirty).toBe(true);
  });

  it("Undo restores as unsaved work; Discard and saving leave nothing unsaved", () => {
    const start = clean();
    const edited = builderReducer(start, mintingActions.addWorkout());
    const discarded = builderReducer(edited, {
      type: "reset",
      tree: start.tree,
    });
    expect(discarded).toEqual({ tree: start.tree, dirty: false });
    const undone = builderReducer(discarded, {
      type: "restore",
      tree: edited.tree,
    });
    expect(undone).toEqual({ tree: edited.tree, dirty: true });
    expect(builderReducer(undone, { type: "saved" })).toEqual({
      tree: edited.tree,
      dirty: false,
    });
  });
});
