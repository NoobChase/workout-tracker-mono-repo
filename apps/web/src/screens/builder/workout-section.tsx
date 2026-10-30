import type { WeightUnit, WorkoutNode } from "@workout-tracker/shared";
import { Ellipsis, GripVertical, Lock, Plus } from "lucide-react";
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent,
} from "react";
import { relativeDay, repRange, unitLabel } from "../format.js";
import { Figures, PlaceholderMark } from "./markers.js";
import { mintingActions, type BuilderAction } from "./reducer.js";
import { SlotEditor } from "./slot-editor.js";
import { groupLabels, slotSummary, type DraftWorkout } from "./tree.js";
import { Button } from "@/ui/button";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@/ui/menu";
import { cn } from "@/lib/utils";

/*
 * One workout of the cycle as a numbered section (brief
 * `apps-web-src-builder`): its name edited in place, a notes line for rest
 * guidance, a ⋯ menu, its slots as one-line rows that open in place, and
 * "+ Add exercise". A trained workout (D5) is drawn greyed and read-only:
 * "Logged <day> · locked".
 */

/** What a slot (or a stored one) is called: its exercise, else its label. */
export type SlotNamer = (slot: {
  exerciseId: string | null;
  placeholderLabel: string | null;
}) => string;

export function WorkoutSection({
  index,
  count,
  workout,
  canMoveUp,
  canMoveDown,
  unitOf,
  slotName,
  expanded,
  onExpand,
  onPick,
  dispatch,
  announce,
}: {
  index: number;
  /** How many workouts the cycle has, for "moved to 2 of 4". */
  count: number;
  workout: DraftWorkout;
  /** It may trade places with the workout above (or below): neither trained. */
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** The unit a slot's weights are prescribed in (override, else default). */
  unitOf: (exerciseId: string | null) => WeightUnit;
  slotName: SlotNamer;
  /** The slot open in place, by id. */
  expanded: string | null;
  /** Opens a slot in place, or closes it when it is the one open. */
  onExpand: (slotId: string) => void;
  /** Opens the exercise picker: to replace slot `si`, or to add one. */
  onPick: (si?: number) => void;
  dispatch: (action: BuilderAction) => void;
  /** Says a reorder out loud (a polite live region). */
  announce: (message: string) => void;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  const headingId = useId();
  const [notesOpen, setNotesOpen] = useState<Set<string>>(new Set());

  if (workout.frozen) {
    return (
      <FrozenSection
        index={index}
        node={workout.frozen}
        trainedAt={workout.trainedAt}
        slotName={slotName}
      />
    );
  }

  const wi = index;
  const labels = groupLabels(workout.slots);
  const move = (direction: -1 | 1) => {
    dispatch({ type: "move-workout", wi, direction });
    announce(`${workout.name} moved to ${index + 1 + direction} of ${count}.`);
  };

  return (
    <section aria-labelledby={headingId} className="flex flex-col">
      <h2 id={headingId} className="sr-only">
        Workout {index + 1}: {workout.name || "unnamed"}
      </h2>
      <div className="flex items-center gap-3 border-b border-line-2 pb-2">
        <span
          aria-hidden="true"
          className="num w-6 shrink-0 text-[15px] text-faint"
        >
          {index + 1}
        </span>
        <input
          ref={nameRef}
          aria-label={`Name of workout ${index + 1}`}
          value={workout.name}
          onChange={(e) =>
            dispatch({ type: "rename-workout", wi, name: e.target.value })
          }
          autoComplete="off"
          className={cn(
            "-mx-2 h-11 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-xl leading-tight font-bold tracking-[-0.01em]",
            "transition-[border-color] duration-150 ease-out hover:border-line-2 focus-visible:border-ring",
            workout.name.trim() === "" && "border-danger",
          )}
        />
        <Menu>
          <MenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`More for ${workout.name || `workout ${index + 1}`}`}
              className="-mr-2.5 data-[state=open]:bg-ghost data-[state=open]:text-foreground"
            >
              <Ellipsis aria-hidden="true" strokeWidth={1.75} />
            </Button>
          </MenuTrigger>
          <MenuContent>
            <MenuItem
              onSelect={() =>
                // After the menu has handed focus back to its trigger.
                setTimeout(() => nameRef.current?.select(), 0)
              }
            >
              Rename
            </MenuItem>
            <MenuItem disabled={!canMoveUp} onSelect={() => move(-1)}>
              Move up
            </MenuItem>
            <MenuItem disabled={!canMoveDown} onSelect={() => move(1)}>
              Move down
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              className="text-danger"
              onSelect={() => dispatch({ type: "remove-workout", wi })}
            >
              Remove workout
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
      <input
        aria-label={`Notes for ${workout.name || `workout ${index + 1}`}`}
        placeholder="Notes, such as rest: 2–3 min on the big lifts"
        value={workout.notes ?? ""}
        onChange={(e) =>
          dispatch({
            type: "workout-notes",
            wi,
            notes: e.target.value === "" ? null : e.target.value,
          })
        }
        autoComplete="off"
        className={cn(
          "-mx-2 mt-1 ml-7 h-11 min-w-0 rounded-md border border-transparent bg-transparent px-2 text-[15px] text-muted-foreground placeholder:text-faint",
          "transition-[border-color] duration-150 ease-out hover:border-line-2 focus-visible:border-ring focus-visible:text-foreground",
        )}
      />
      <SlotList
        wi={wi}
        workout={workout}
        labels={labels}
        slotName={slotName}
        unitOf={unitOf}
        expanded={expanded}
        onExpand={onExpand}
        onPick={onPick}
        notesOpen={notesOpen}
        onNotesOpen={(id) => setNotesOpen((s) => new Set(s).add(id))}
        dispatch={dispatch}
        announce={announce}
      />
      <div className="pt-2 pl-7">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3.5"
          onClick={() => onPick()}
        >
          <Plus aria-hidden="true" strokeWidth={1.75} />
          Add exercise
        </Button>
      </div>
    </section>
  );
}

function SlotList({
  wi,
  workout,
  labels,
  slotName,
  unitOf,
  expanded,
  onExpand,
  onPick,
  notesOpen,
  onNotesOpen,
  dispatch,
  announce,
}: {
  wi: number;
  workout: DraftWorkout;
  labels: Map<string, string>;
  slotName: SlotNamer;
  unitOf: (exerciseId: string | null) => WeightUnit;
  expanded: string | null;
  onExpand: (slotId: string) => void;
  onPick: (si: number) => void;
  notesOpen: Set<string>;
  onNotesOpen: (slotId: string) => void;
  dispatch: (action: BuilderAction) => void;
  announce: (message: string) => void;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  // After a keyboard move, keep focus on the moved row's handle.
  const refocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!refocus.current) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-handle="${refocus.current}"]`)
      ?.focus();
    refocus.current = null;
  });

  const slots = workout.slots;
  const n = slots.length;
  if (n === 0) {
    return (
      <p className="border-b border-line py-3 pl-11 text-[15px] text-muted-foreground">
        No exercises yet.
      </p>
    );
  }

  const moveBy = (si: number, delta: number, viaKeyboard = false) => {
    const to = si + delta;
    if (to < 0 || to >= n) return;
    if (viaKeyboard) refocus.current = slots[si]!.id;
    dispatch({ type: "move-slot", wi, from: si, to });
    announce(`${slotName(slots[si]!)} moved to ${to + 1} of ${n}.`);
  };

  // Laptop drag: the handle captures the pointer; the row under it is where
  // the slot lands. Rows are measured as the pointer moves.
  const overIndex = (clientY: number) => {
    const rows = listRef.current?.querySelectorAll<HTMLElement>(":scope > li");
    if (!rows) return 0;
    let index = rows.length - 1;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!.getBoundingClientRect();
      if (clientY < r.top + r.height / 2) {
        index = i;
        break;
      }
    }
    return index;
  };
  const onPointerDown = (si: number) => (e: ReactPointerEvent) => {
    if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ from: si, over: si });
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    if (!drag) return;
    const over = overIndex(e.clientY);
    if (over !== drag.over) setDrag({ ...drag, over });
  };
  const onPointerUp = () => {
    if (!drag) return;
    const { from, over } = drag;
    setDrag(null);
    if (over !== from) moveBy(from, over - from);
  };
  const onHandleKey = (si: number) => (e: KeyboardEvent) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      moveBy(si, -1, true);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      moveBy(si, 1, true);
    }
  };

  return (
    <ol ref={listRef} className="flex flex-col">
      {slots.map((slot, si) => {
        const label = labels.get(slot.id);
        const prevGrouped =
          slot.groupKey !== null && slots[si - 1]?.groupKey === slot.groupKey;
        const nextGrouped =
          slot.groupKey !== null && slots[si + 1]?.groupKey === slot.groupKey;
        const open = expanded === slot.id;
        const name = slotName(slot);
        const editorId = `slot-${slot.id}`;
        const dropping =
          drag !== null && drag.over === si && drag.from !== si
            ? drag.over < drag.from
              ? "before"
              : "after"
            : null;
        return (
          <li
            key={slot.id}
            className={cn(
              "relative flex flex-col border-b border-line pl-2",
              drag?.from === si && "opacity-55",
            )}
          >
            {slot.groupKey !== null ? (
              // The superset's copper bar runs the length of the group.
              <span
                aria-hidden="true"
                className={cn(
                  "absolute left-0 w-[3px] bg-copper",
                  prevGrouped ? "-top-px" : "top-3 rounded-t-full",
                  nextGrouped ? "-bottom-px" : "bottom-3 rounded-b-full",
                )}
              />
            ) : null}
            {dropping ? (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute right-0 left-2 h-0.5 bg-foreground",
                  dropping === "before" ? "-top-px" : "-bottom-px",
                )}
              />
            ) : null}
            <div className="flex min-h-14 items-center gap-2">
              <span
                aria-hidden="true"
                className="num w-7 shrink-0 text-[13px] font-medium text-muted-foreground"
              >
                {label}
              </span>
              <button
                type="button"
                aria-expanded={open}
                aria-controls={open ? editorId : undefined}
                onClick={() => onExpand(slot.id)}
                className="flex min-h-14 min-w-0 flex-1 flex-col justify-center py-2 text-left outline-offset-[-2px]"
              >
                <span className="flex min-w-0 items-center gap-2 text-[15px] font-semibold">
                  {label ? (
                    <span className="sr-only">Superset {label}: </span>
                  ) : null}
                  {slot.exerciseId === null ? (
                    <>
                      <PlaceholderMark className="text-muted-foreground" />
                      <span className="sr-only">Placeholder:</span>
                      <span className="truncate">“{name}”</span>
                    </>
                  ) : (
                    <span className="truncate">{name}</span>
                  )}
                </span>
                <span className="truncate text-[13px] text-muted-foreground">
                  <Figures text={slotSummary(slot)} />
                </span>
              </button>
              <button
                type="button"
                data-handle={slot.id}
                aria-label={`Reorder ${name}: arrow keys move it`}
                onPointerDown={onPointerDown(si)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={() => setDrag(null)}
                onKeyDown={onHandleKey(si)}
                className={cn(
                  "hidden size-11 shrink-0 cursor-grab touch-none place-items-center rounded-md text-faint",
                  "transition-[background-color,color] duration-150 hover:bg-ghost hover:text-foreground active:cursor-grabbing",
                  "pointer-fine:grid",
                )}
              >
                <GripVertical
                  aria-hidden="true"
                  strokeWidth={1.75}
                  className="size-4"
                />
              </button>
              <Menu>
                <MenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`More for ${name}`}
                    className="-mr-2.5 data-[state=open]:bg-ghost data-[state=open]:text-foreground"
                  >
                    <Ellipsis aria-hidden="true" strokeWidth={1.75} />
                  </Button>
                </MenuTrigger>
                <MenuContent>
                  <MenuItem
                    disabled={si === n - 1}
                    onSelect={() =>
                      dispatch({ type: "superset-with-next", wi, si })
                    }
                  >
                    Superset with next
                  </MenuItem>
                  {slot.groupKey !== null ? (
                    <MenuItem
                      onSelect={() => dispatch({ type: "ungroup", wi, si })}
                    >
                      Ungroup
                    </MenuItem>
                  ) : null}
                  <MenuItem onSelect={() => onPick(si)}>
                    Replace exercise…
                  </MenuItem>
                  <MenuItem disabled={si === 0} onSelect={() => moveBy(si, -1)}>
                    Move up
                  </MenuItem>
                  <MenuItem
                    disabled={si === n - 1}
                    onSelect={() => moveBy(si, 1)}
                  >
                    Move down
                  </MenuItem>
                  <MenuItem
                    onSelect={() => {
                      onNotesOpen(slot.id);
                      if (!open) onExpand(slot.id);
                    }}
                  >
                    Notes
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem
                    className="text-danger"
                    onSelect={() => dispatch({ type: "remove-slot", wi, si })}
                  >
                    Remove
                  </MenuItem>
                </MenuContent>
              </Menu>
            </div>
            {open ? (
              <div id={editorId}>
                <SlotEditor
                  slot={slot}
                  name={name}
                  unit={unitOf(slot.exerciseId)}
                  showNotes={slot.notes !== null || notesOpen.has(slot.id)}
                  onTargetSets={(count) =>
                    dispatch(mintingActions.setTargetSets(wi, si, count))
                  }
                  onPerSet={(perSet) =>
                    dispatch({ type: "per-set", wi, si, perSet })
                  }
                  onLine={(line, patch) =>
                    dispatch({
                      type: "update-line",
                      wi,
                      si,
                      line,
                      patch,
                      unit: unitOf(slot.exerciseId),
                    })
                  }
                  onNotes={(notes) =>
                    dispatch({ type: "slot-notes", wi, si, notes })
                  }
                />
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * A trained workout (D5): its plan is what its logged session is compared
 * against, so it is shown, greyed, and nothing about it can change.
 */
function FrozenSection({
  index,
  node,
  trainedAt,
  slotName,
}: {
  index: number;
  node: WorkoutNode;
  /** The first session's time. */
  trainedAt: string | null;
  slotName: SlotNamer;
}) {
  const headingId = useId();
  const slots = [...node.plannedExercises].sort(
    (a, b) => a.position - b.position,
  );
  return (
    <section
      aria-labelledby={headingId}
      data-locked=""
      className="flex flex-col text-muted-foreground"
    >
      <div className="flex min-h-[3.25rem] items-center gap-3 border-b border-line pb-2">
        <span
          aria-hidden="true"
          className="num w-6 shrink-0 text-[15px] text-faint"
        >
          {index + 1}
        </span>
        <h2
          id={headingId}
          className="min-w-0 flex-1 truncate text-xl leading-tight font-bold tracking-[-0.01em]"
        >
          {node.name}
        </h2>
        <span className="flex shrink-0 items-center gap-1.5 text-[13px]">
          <Lock aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
          {trainedAt ? `Logged ${relativeDay(trainedAt)}` : "Logged"} · locked
        </span>
      </div>
      {node.notes ? (
        <p className="ml-7 py-2 text-[15px]">{node.notes}</p>
      ) : null}
      <ol className="flex flex-col">
        {slots.map((s) => {
          const name = slotName(s);
          const first = s.plannedSets[0];
          const reps = first
            ? repRange(first.targetRepsMin, first.targetRepsMax)
            : null;
          const weight =
            first?.targetWeight != null && first.weightUnit !== null
              ? ` @ ${first.targetWeight} ${unitLabel(first.weightUnit)}`
              : "";
          return (
            <li
              key={s.id}
              className="flex min-h-12 flex-col justify-center border-b border-line py-2 pl-11"
            >
              <span className="truncate text-[15px] font-semibold">
                {s.exerciseId ? name : `“${name}”`}
              </span>
              <span className="text-[13px]">
                <Figures
                  text={
                    reps
                      ? `${s.targetSets} × ${reps}${weight}`
                      : `${s.targetSets} sets`
                  }
                />
              </span>
            </li>
          );
        })}
      </ol>
      <p className="ml-7 pt-2 text-[13px]">
        A workout with a logged session keeps its plan, so the log can be
        compared against it.
      </p>
    </section>
  );
}
