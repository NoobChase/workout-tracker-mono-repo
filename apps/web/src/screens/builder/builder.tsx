import type {
  ApplyPreviewResponse,
  SaveCycleRequest,
  UnitSettings,
} from "@workout-tracker/shared";
import { Plus } from "lucide-react";
import { useMemo, useReducer, useState } from "react";
import { useNavigate } from "react-router";
import { useExercises, useOnline } from "../../data/hooks.js";
import { nameOf } from "../../local/loggable.js";
import { resolveUnit } from "../../local/units.js";
import { ExercisePicker } from "../exercise-picker.js";
import { programErrorText } from "../program-format.js";
import { ApplySheet } from "./apply-sheet.js";
import { CycleStrip, type StripCycle } from "./cycle-strip.js";
import { useDraftAutosave } from "./draft.js";
import type { BuilderMode } from "./modes.js";
import {
  builderReducer,
  mintingActions,
  type BuilderAction,
} from "./reducer.js";
import {
  IDLE,
  isSaving,
  SaveBar,
  type SaveState,
  type SubmitOutcome,
} from "./save-bar.js";
import { canMoveWorkout, type BuilderState, type SlotChoice } from "./tree.js";
import { WorkoutSection, type SlotNamer } from "./workout-section.js";
import { Button } from "@/ui/button";
import { toast } from "@/ui/toaster";

/*
 * The program builder (brief `apps-web-src-builder`; operations.md 3.1-3.8;
 * design D3-D7, D14 of step-4a): one outline page per cycle, the same for a
 * new program and a stored cycle; what differs is the `mode`. Every edit
 * lands in the device draft a beat later; saving is one online request, so
 * offline the page says saving needs a connection and keeps the draft.
 */

export interface Loaded<S extends BuilderState> {
  tree: S;
  /** It came from this device's draft, not the server. */
  restored: boolean;
}

/** Where the exercise picker is adding or replacing. */
type Picking = { wi: number; si?: number };

export function Builder<S extends BuilderState>({
  initial,
  mode,
  owner,
  units,
  strip,
}: {
  /** Read once, when the builder opens. */
  initial: Loaded<S>;
  mode: BuilderMode<S>;
  /** Whose draft this is. */
  owner: string;
  /** The lifter's units: a new weight is written in its exercise's. */
  units: UnitSettings;
  strip: StripCycle[];
}) {
  const navigate = useNavigate();
  const online = useOnline();
  const exercises = useExercises();

  const [model, apply] = useReducer(builderReducer<S>, {
    tree: initial.tree,
    dirty: initial.restored,
  });
  const { tree, dirty } = model;
  const n = tree.cycleNumber;
  const autosave = useDraftAutosave(model, owner, mode.programId);
  const [save, setSave] = useState<SaveState>(IDLE);
  // The apply sheet's content, kept while it animates out.
  const [sheet, setSheet] = useState<ApplyPreviewResponse | null>(null);
  const [restored, setRestored] = useState(initial.restored);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [picking, setPicking] = useState<Picking | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [message, setMessage] = useState("");

  const names = useMemo(
    () => new Map((exercises.data?.exercises ?? []).map((e) => [e.id, e.name])),
    [exercises.data],
  );
  const slotName: SlotNamer = (slot) =>
    nameOf({
      name:
        slot.exerciseId === null
          ? null
          : (names.get(slot.exerciseId) ??
            (exercises.isPending ? "…" : "Exercise")),
      placeholderLabel: slot.placeholderLabel,
    });

  /**
   * Every edit. A problem the bar was showing goes with it; removing says
   * so with an Undo that puts the cycle back as it was.
   */
  function dispatch(action: BuilderAction) {
    const before = tree;
    apply(action);
    setSave((s) => (s.kind === "problem" ? IDLE : s));
    if (action.type === "remove-workout") {
      removed(before, before.workouts[action.wi]?.name || "the workout");
    } else if (action.type === "remove-slot") {
      const slot = before.workouts[action.wi]?.slots[action.si];
      removed(before, slot ? slotName(slot) : "the slot");
    }
  }
  function removed(before: S, what: string) {
    toast(`Removed ${what}`, {
      action: {
        label: "Undo",
        onClick: () => apply({ type: "restore", tree: before }),
      },
    });
  }

  // --- Saving --------------------------------------------------------------

  async function settle(outcome: Promise<SubmitOutcome>) {
    const result = await outcome;
    if (result.kind === "saved") {
      apply({ type: "saved" });
      await autosave.forget().catch(() => undefined);
      toast(result.title, { description: result.description });
      void navigate(`/programs/${tree.programId}`);
      return;
    }
    if (result.kind === "choose") setSheet(result.preview);
    setSave(result);
  }

  function submit() {
    setSave({ kind: "busy" });
    void settle(mode.submit(tree));
  }

  function commit(applyTo: SaveCycleRequest["applyTo"]) {
    if (save.kind !== "choose") return;
    setSave({ kind: "applying" });
    void settle(save.commit(applyTo));
  }

  async function reload() {
    if (save.kind !== "stale") return;
    try {
      // One read: the tree and the fingerprint it is rebased on (D17).
      const cycle = await save.reread();
      apply({ type: "rebase", cycle });
      setSave(IDLE);
      toast(`Cycle ${n} reloaded`, {
        description: "Your changes are kept. Check them, then save again.",
      });
    } catch (e) {
      setSave({
        kind: "problem",
        message: `Couldn’t reload. ${programErrorText(e)}`,
      });
    }
  }

  // Discarding is one tap with an Undo, like removing (the draft is the
  // lifter's work; a mis-tap must not lose it). Undo puts the draft back as
  // it was, and the autosave writes it to the device again.
  async function discard() {
    const before = tree;
    try {
      const clean = await mode.fresh();
      await autosave.forget();
      apply({ type: "reset", tree: clean });
      setRestored(false);
      setSave(IDLE);
      toast("Changes discarded", {
        description: mode.discarded,
        action: {
          label: "Undo",
          onClick: () => {
            setSave((s) => (s.kind === "problem" ? IDLE : s));
            apply({ type: "restore", tree: before });
          },
        },
      });
    } catch (e) {
      setSave({
        kind: "problem",
        message: `Couldn’t load the saved version. ${programErrorText(e)}`,
      });
    }
  }

  // --- The picker ----------------------------------------------------------

  function pick(at: Picking) {
    setPicking(at);
    setPickerOpen(true);
  }

  function choose(choice: SlotChoice) {
    if (!picking) return;
    const { wi, si } = picking;
    if (si === undefined) {
      const action = mintingActions.addSlot(wi, choice);
      dispatch(action);
      // The new slot opens in place, ready for its sets.
      setExpanded(action.slotId);
    } else {
      dispatch({ type: "replace-slot", wi, si, choice });
    }
  }

  const pickerTitle = (() => {
    if (!picking) return "Add exercise";
    const w = tree.workouts[picking.wi];
    if (picking.si === undefined) return `Add to ${w?.name || "workout"}`;
    const slot = w?.slots[picking.si];
    return `Replace ${slot ? slotName(slot) : "exercise"}`;
  })();

  return (
    <div className="flex max-w-3xl flex-col">
      <div className="flex flex-col gap-5 pt-3 pb-6">
        {mode.heading(tree, dispatch)}
        <CycleStrip programId={mode.programId} cycles={strip} current={n} />
        <div className="flex flex-col gap-1">
          <h2 className="text-[17px] leading-snug font-semibold">
            Cycle <span className="num">{n}</span>
          </h2>
          <p className="max-w-[60ch] text-[15px] text-muted-foreground">
            {mode.intro}
          </p>
        </div>
        {restored ? (
          <p
            role="status"
            className="flex flex-wrap items-center gap-x-1 border-y border-line py-1 text-[15px]"
          >
            Unsaved changes restored
            <span aria-hidden="true" className="text-muted-foreground">
              ·
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="-ml-1.5"
              onClick={() => void discard()}
            >
              Discard
            </Button>
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-10">
        {tree.workouts.map((w, wi) => (
          <WorkoutSection
            key={w.id}
            index={wi}
            count={tree.workouts.length}
            workout={w}
            canMoveUp={canMoveWorkout(tree.workouts, wi, -1)}
            canMoveDown={canMoveWorkout(tree.workouts, wi, 1)}
            unitOf={(exerciseId) => resolveUnit(units, exerciseId)}
            slotName={slotName}
            expanded={expanded}
            onExpand={(slotId) =>
              setExpanded((open) => (open === slotId ? null : slotId))
            }
            onPick={(si) => pick({ wi, si })}
            dispatch={dispatch}
            announce={setMessage}
          />
        ))}
        <div>
          <Button onClick={() => dispatch(mintingActions.addWorkout())}>
            <Plus aria-hidden="true" strokeWidth={1.75} />
            Add workout
          </Button>
        </div>
      </div>

      <p aria-live="polite" className="sr-only">
        {message}
      </p>

      <SaveBar
        save={save}
        cycleNumber={n}
        dirty={dirty}
        online={online}
        saveLabel={mode.saveLabel}
        cleanNote={mode.cleanNote}
        needsChanges={mode.needsChanges}
        onSave={submit}
        onReload={() => void reload()}
        onDiscard={() => void discard()}
      />

      <ExercisePicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title={pickerTitle}
        onPick={choose}
      />
      {sheet ? (
        <ApplySheet
          key={sheet.source + sheet.later.map((c) => c.fingerprint).join()}
          open={save.kind === "choose" || save.kind === "applying"}
          onOpenChange={(open) => {
            // Closed while choosing: nothing is saved. While sending, the
            // save goes on behind the bar.
            if (open) return;
            setSave((s) =>
              s.kind === "choose"
                ? IDLE
                : s.kind === "applying"
                  ? { kind: "busy" }
                  : s,
            );
          }}
          preview={sheet}
          busy={isSaving(save)}
          onSave={commit}
        />
      ) : null}
    </div>
  );
}
