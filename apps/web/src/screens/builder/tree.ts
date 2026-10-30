import {
  programLimits,
  type CycleDetailResponse,
  type CycleTreeInput,
  type PlannedSetNode,
  type WeightUnit,
  type WorkoutNode,
} from "@workout-tracker/shared";
import { effortOf, effortText, type EffortScale } from "@/lib/effort";
import { repRange, unitLabel } from "../format.js";

/*
 * The builder's model of one cycle, and every edit to it, as pure functions
 * (brief `apps-web-src-builder`; operations.md 3.1-3.7; design D3-D5 of
 * step-4a). The screen holds a `BuilderState` (through `builderReducer`),
 * stores it as the device draft (D14), and sends `toCycleTree` whole: the
 * server diffs it by id, so kept rows keep their ids and new ones carry ids
 * minted on the device, passed in explicitly: nothing here mints.
 *
 * Trained workouts (D5) are kept as the stored node and sent back verbatim;
 * nothing here edits, moves or places anything before them.
 */

/** One prescribed set as the editor shows it: one line. */
export interface SetLine {
  id: string;
  repsMin: number | null;
  repsMax: number | null;
  weight: number | null;
  weightUnit: WeightUnit | null;
  /** Which scale the small switch is on; kept even with no value. */
  effortKind: EffortScale;
  effort: number | null;
  /** Columns this builder doesn't edit yet, kept exactly as stored. */
  keep: {
    targetDurationSeconds: number | null;
    targetDistance: number | null;
    distanceUnit: PlannedSetNode["distanceUnit"];
    notes: string | null;
  };
}

export interface Slot {
  id: string;
  /** Exactly one of these two is set (operations.md 3.3, 3.5). */
  exerciseId: string | null;
  placeholderLabel: string | null;
  targetSets: number;
  /** Equal keys in one workout are a superset; labels are derived. */
  groupKey: number | null;
  notes: string | null;
  /** "Prescribe each set": one line per set instead of one for all. */
  perSet: boolean;
  /** One line per target set, always `targetSets` long. */
  sets: SetLine[];
  /** The stored position, kept when the order allows (`null`: new). */
  storedPosition: number | null;
}

export interface DraftWorkout {
  id: string;
  name: string;
  notes: string | null;
  slots: Slot[];
  storedPosition: number | null;
  /**
   * Trained (D5): the node exactly as stored, sent back unchanged. `null`
   * for every workout the builder may edit.
   */
  frozen: WorkoutNode | null;
  /**
   * When a frozen workout was first trained (its earliest session), for
   * "Logged <day> · locked"; `null` for an editable one.
   */
  trainedAt: string | null;
}

export type ProgramLength =
  { kind: "fixed"; cycles: number } | { kind: "open" };

interface CycleState {
  /** Minted on the device when creating, and kept across retries (D3). */
  programId: string;
  /** The cycle's `workout_plans` row. */
  cycleId: string;
  cycleNumber: number;
  workouts: DraftWorkout[];
}

/** Cycle 1 of a program being created, with its name and length. */
export interface CreateState extends CycleState {
  mode: "create";
  name: string;
  length: ProgramLength;
}

/** A stored cycle being edited. */
export interface EditState extends CycleState {
  mode: "edit";
  /**
   * The cycle's fingerprint when it was loaded, sent as `expected.source`,
   * so a save over a cycle changed since is refused (D7, D17).
   */
  baseline: string;
  /** The program's name when it was loaded: the heading while offline. */
  programName: string;
}

export type BuilderState = CreateState | EditState;

export type Mint = () => string;

/** A slot's target is at most this many sets (D17). */
export const MAX_TARGET_SETS = programLimits.setsPerExercise;

// --- Lines -------------------------------------------------------------------

export function emptyLine(id: string): SetLine {
  return {
    id,
    repsMin: null,
    repsMax: null,
    weight: null,
    weightUnit: null,
    effortKind: "RIR",
    effort: null,
    keep: {
      targetDurationSeconds: null,
      targetDistance: null,
      distanceUnit: null,
      notes: null,
    },
  };
}

/** Nothing prescribed: a freeform set. */
export function isEmptyLine(line: SetLine): boolean {
  return (
    line.repsMin === null &&
    line.repsMax === null &&
    line.weight === null &&
    line.effort === null &&
    line.keep.targetDurationSeconds === null &&
    line.keep.targetDistance === null &&
    line.keep.notes === null
  );
}

/** The same prescription, ignoring the id (and the unused switch side). */
function sameLine(a: SetLine, b: SetLine): boolean {
  return (
    a.repsMin === b.repsMin &&
    a.repsMax === b.repsMax &&
    a.weight === b.weight &&
    (a.weight === null || a.weightUnit === b.weightUnit) &&
    a.effort === b.effort &&
    (a.effort === null || a.effortKind === b.effortKind) &&
    a.keep.targetDurationSeconds === b.keep.targetDurationSeconds &&
    a.keep.targetDistance === b.keep.targetDistance &&
    a.keep.distanceUnit === b.keep.distanceUnit &&
    a.keep.notes === b.keep.notes
  );
}

function lineFromNode(node: PlannedSetNode): SetLine {
  const effort = effortOf(node);
  return {
    id: node.id,
    repsMin: node.targetRepsMin,
    repsMax: node.targetRepsMax,
    weight: node.targetWeight,
    weightUnit: node.weightUnit,
    effortKind: effort?.scale ?? "RIR",
    effort: effort?.value ?? null,
    keep: {
      targetDurationSeconds: node.targetDurationSeconds,
      targetDistance: node.targetDistance,
      distanceUnit: node.distanceUnit,
      notes: node.notes,
    },
  };
}

function nodeFromLine(line: SetLine, setNumber: number): PlannedSetNode {
  return {
    id: line.id,
    setNumber,
    targetRepsMin: line.repsMin,
    targetRepsMax: line.repsMax,
    targetWeight: line.weight,
    weightUnit: line.weight === null ? null : line.weightUnit,
    targetDurationSeconds: line.keep.targetDurationSeconds,
    targetDistance: line.keep.targetDistance,
    distanceUnit: line.keep.distanceUnit,
    targetRpe: line.effortKind === "RPE" ? line.effort : null,
    targetRir: line.effortKind === "RIR" ? line.effort : null,
    notes: line.keep.notes,
  };
}

/**
 * The slot's prescribed sets as stored: one per line, numbered from 1, with
 * trailing freeform sets left out ("sets 1-3 prescribed, set 4 freeform").
 */
export function plannedSetsOf(slot: Slot): PlannedSetNode[] {
  let last = slot.sets.length;
  while (last > 0 && isEmptyLine(slot.sets[last - 1]!)) last--;
  return slot.sets.slice(0, last).map((line, i) => nodeFromLine(line, i + 1));
}

// --- From the server ---------------------------------------------------------

type StoredWorkout = CycleDetailResponse["cycle"]["workouts"][number];

/** A stored workout as the tree node a save sends back: no `trained` flag. */
export function storedNode(w: StoredWorkout): WorkoutNode {
  const node: Partial<StoredWorkout> = { ...w };
  delete node.trained;
  delete node.trainedAt;
  return node as WorkoutNode;
}

function slotFromNode(
  node: StoredWorkout["plannedExercises"][number],
  mint: Mint,
): Slot {
  const stored = [...node.plannedSets].sort(
    (a, b) => a.setNumber - b.setNumber,
  );
  const lines = stored.map(lineFromNode);
  // Every target set gets a line: the unprescribed ones are freeform.
  while (lines.length < node.targetSets) lines.push(emptyLine(mint()));
  const uniform =
    stored.length === 0 ||
    (stored.length === node.targetSets &&
      lines.every((l) => sameLine(l, lines[0]!)));
  return {
    id: node.id,
    exerciseId: node.exerciseId,
    placeholderLabel: node.placeholderLabel,
    targetSets: node.targetSets,
    groupKey: node.groupKey,
    notes: node.notes,
    perSet: !uniform,
    sets: lines,
    storedPosition: node.position,
  };
}

/**
 * The editable state of a stored cycle, based on the fingerprint read with
 * it (D17). `mint` gives each unprescribed (freeform) set its line's id.
 */
export function fromCycle(
  detail: CycleDetailResponse,
  options: { programName: string; mint: Mint },
): EditState {
  const workouts = [...detail.cycle.workouts].sort(
    (a, b) => a.position - b.position,
  );
  return {
    mode: "edit",
    programId: detail.programId,
    cycleId: detail.cycle.id,
    cycleNumber: detail.cycleNumber,
    programName: options.programName,
    baseline: detail.fingerprint,
    workouts: workouts.map((w) => ({
      id: w.id,
      name: w.name,
      notes: w.notes,
      storedPosition: w.position,
      slots: [...w.plannedExercises]
        .sort((a, b) => a.position - b.position)
        .map((s) => slotFromNode(s, options.mint)),
      frozen: w.trained ? storedNode(w) : null,
      trainedAt: w.trained ? w.trainedAt : null,
    })),
  };
}

/** A blank workout, named by the caller. */
function blankWorkout(id: string, name: string): DraftWorkout {
  return {
    id,
    name,
    notes: null,
    slots: [],
    storedPosition: null,
    frozen: null,
    trainedAt: null,
  };
}

/** A blank program: cycle 1 with one empty workout. */
export function newProgram(mint: Mint): CreateState {
  return {
    mode: "create",
    programId: mint(),
    cycleId: mint(),
    cycleNumber: 1,
    name: "",
    length: { kind: "fixed", cycles: 12 },
    workouts: [blankWorkout(mint(), "Workout 1")],
  };
}

// --- To the server -----------------------------------------------------------

/**
 * Positions for a sequence whose `fixed` items must keep their stored
 * position (trained workouts, D5). Between two fixed items, the others keep
 * their stored positions when those are still in order and in range, so an
 * unedited cycle is sent back exactly as stored; otherwise they are numbered
 * on from the fixed item before them. Nothing is ever placed before a fixed
 * item that wasn't there already, so the numbers always fit.
 */
export function assignPositions(
  items: readonly { storedPosition: number | null; fixed: boolean }[],
): number[] {
  const out = new Array<number>(items.length);
  let start = 0;
  let floor = -1;
  while (start <= items.length) {
    let end = start;
    while (end < items.length && !items[end]!.fixed) end++;
    const ceiling =
      end < items.length
        ? items[end]!.storedPosition!
        : Number.POSITIVE_INFINITY;
    const run = items.slice(start, end);
    const stored = run.map((i) => i.storedPosition);
    const keep =
      stored.every((p): p is number => p !== null) &&
      stored.every((p, k) => p > (k === 0 ? floor : stored[k - 1]!)) &&
      (stored.length === 0 || stored[stored.length - 1]! < ceiling);
    run.forEach((_, k) => {
      out[start + k] = keep ? stored[k]! : floor + 1 + k;
    });
    if (end < items.length) {
      out[end] = ceiling;
      floor = ceiling;
    }
    start = end + 1;
  }
  return out;
}

/** The whole desired cycle, as `POST /programs` and `PUT …/cycles/:n` take it. */
export function toCycleTree(state: BuilderState): CycleTreeInput {
  const positions = assignPositions(
    state.workouts.map((w) => ({
      storedPosition: w.storedPosition,
      fixed: w.frozen !== null,
    })),
  );
  return {
    id: state.cycleId,
    workouts: state.workouts.map((w, i) => {
      if (w.frozen) return w.frozen;
      const slotPositions = assignPositions(
        w.slots.map((s) => ({
          storedPosition: s.storedPosition,
          fixed: false,
        })),
      );
      const groups = canonicalGroups(w.slots);
      return {
        id: w.id,
        name: w.name.trim(),
        position: positions[i]!,
        notes: blankToNull(w.notes),
        plannedExercises: w.slots.map((s, k) => ({
          id: s.id,
          exerciseId: s.exerciseId,
          placeholderLabel: s.exerciseId === null ? s.placeholderLabel : null,
          position: slotPositions[k]!,
          targetSets: s.targetSets,
          groupKey: groups[k]!,
          notes: blankToNull(s.notes),
          plannedSets: plannedSetsOf(s),
        })),
      };
    }),
  };
}

function blankToNull(text: string | null): string | null {
  return text === null || text.trim() === "" ? null : text;
}

/**
 * Group keys renumbered 1, 2, … by first appearance, as the fingerprint
 * normalizes them; keys that are already in that form are kept as they are.
 */
function canonicalGroups(slots: readonly Slot[]): (number | null)[] {
  const seen = new Map<number, number>();
  const renumbered = slots.map((s) => {
    if (s.groupKey === null) return null;
    if (!seen.has(s.groupKey)) seen.set(s.groupKey, seen.size + 1);
    return seen.get(s.groupKey)!;
  });
  const unchanged = slots.every((s, i) => s.groupKey === renumbered[i]);
  return unchanged ? slots.map((s) => s.groupKey) : renumbered;
}

// --- Derived -----------------------------------------------------------------

/**
 * Superset labels, derived and never stored (operations.md 3.6): the first
 * group in the workout is A (A1, A2, …), the next B, by position.
 */
export function groupLabels(slots: readonly Slot[]): Map<string, string> {
  const labels = new Map<string, string>();
  const letters = new Map<number, string>();
  const counts = new Map<number, number>();
  for (const s of slots) {
    if (s.groupKey === null) continue;
    if (!letters.has(s.groupKey)) {
      letters.set(s.groupKey, String.fromCharCode(65 + letters.size));
    }
    const n = (counts.get(s.groupKey) ?? 0) + 1;
    counts.set(s.groupKey, n);
    labels.set(s.id, `${letters.get(s.groupKey)}${n}`);
  }
  return labels;
}

/**
 * A slot's one-line summary (brief: "5 × 5 @ 225 lb", "3 × 8–10",
 * "3 × 5 @ RIR 2"): target sets × reps, then the weight and the effort
 * target when every set shares them. Sets prescribed one by one read as
 * such.
 */
export function slotSummary(slot: Slot): string {
  const n = slot.targetSets;
  const first = slot.sets[0];
  const uniform =
    first !== undefined && slot.sets.every((l) => sameLine(l, first));
  if (!uniform) {
    const prescribed = plannedSetsOf(slot).length;
    return prescribed < n
      ? `${n} sets · ${prescribed} prescribed, the rest freeform`
      : `${n} sets · each set prescribed`;
  }
  const reps = repRange(first.repsMin, first.repsMax);
  const at = [
    first.weight !== null && first.weightUnit !== null
      ? `${first.weight} ${unitLabel(first.weightUnit)}`
      : null,
    first.effort === null
      ? null
      : effortText({ scale: first.effortKind, value: first.effort }),
  ].filter((x): x is string => x !== null);
  const head = reps ? `${n} × ${reps}` : `${n} ${n === 1 ? "set" : "sets"}`;
  return at.length > 0 ? `${head} @ ${at.join(" · ")}` : head;
}

// --- Rules (D5) --------------------------------------------------------------

export const isFrozen = (w: DraftWorkout) => w.frozen !== null;

/**
 * Whether a workout may swap places with its neighbor: neither may be
 * trained, so no workout ever crosses a trained one.
 */
export function canMoveWorkout(
  workouts: readonly DraftWorkout[],
  index: number,
  direction: -1 | 1,
): boolean {
  const self = workouts[index];
  const other = workouts[index + direction];
  return !!self && !!other && !isFrozen(self) && !isFrozen(other);
}

// --- Edits -------------------------------------------------------------------

// Every edit takes and returns the same kind of state (`S`): a new
// program's edits stay a new program's, an edited cycle's stay its own.

function mapWorkout<S extends BuilderState>(
  state: S,
  index: number,
  edit: (w: DraftWorkout) => DraftWorkout,
): S {
  const w = state.workouts[index];
  if (!w || isFrozen(w)) return state;
  const workouts = [...state.workouts];
  workouts[index] = edit(w);
  return { ...state, workouts };
}

function mapSlot<S extends BuilderState>(
  state: S,
  wi: number,
  si: number,
  edit: (s: Slot) => Slot,
): S {
  return mapWorkout(state, wi, (w) => {
    const s = w.slots[si];
    if (!s) return w;
    const slots = [...w.slots];
    slots[si] = edit(s);
    return { ...w, slots };
  });
}

/** A new workout at the end, "Workout n" for the first free n. */
export function addWorkout<S extends BuilderState>(state: S, id: string): S {
  const names = new Set(state.workouts.map((w) => w.name));
  let n = state.workouts.length + 1;
  while (names.has(`Workout ${n}`)) n++;
  return {
    ...state,
    workouts: [...state.workouts, blankWorkout(id, `Workout ${n}`)],
  };
}

export function renameWorkout<S extends BuilderState>(
  state: S,
  wi: number,
  name: string,
): S {
  return mapWorkout(state, wi, (w) => ({ ...w, name }));
}

export function setWorkoutNotes<S extends BuilderState>(
  state: S,
  wi: number,
  notes: string | null,
): S {
  return mapWorkout(state, wi, (w) => ({ ...w, notes }));
}

export function moveWorkout<S extends BuilderState>(
  state: S,
  wi: number,
  direction: -1 | 1,
): S {
  if (!canMoveWorkout(state.workouts, wi, direction)) return state;
  const workouts = [...state.workouts];
  const [w] = workouts.splice(wi, 1);
  workouts.splice(wi + direction, 0, w!);
  return { ...state, workouts };
}

export function removeWorkout<S extends BuilderState>(state: S, wi: number): S {
  const w = state.workouts[wi];
  if (!w || isFrozen(w)) return state;
  return { ...state, workouts: state.workouts.filter((_, i) => i !== wi) };
}

export type SlotChoice =
  | { exerciseId: string; placeholderLabel?: undefined }
  | { placeholderLabel: string; exerciseId?: undefined };

export const DEFAULT_TARGET_SETS = 3;

/**
 * The ids a new slot is made with: its own, and one per set line, so
 * `lines` holds `DEFAULT_TARGET_SETS` of them.
 */
export interface NewSlotIds {
  slot: string;
  lines: readonly string[];
}

/** A slot at the end of workout `wi`, with `DEFAULT_TARGET_SETS` freeform sets. */
export function addSlot<S extends BuilderState>(
  state: S,
  wi: number,
  choice: SlotChoice,
  ids: NewSlotIds,
): S {
  return mapWorkout(state, wi, (w) => ({
    ...w,
    slots: [
      ...w.slots,
      {
        id: ids.slot,
        exerciseId: choice.exerciseId ?? null,
        placeholderLabel:
          choice.exerciseId === undefined ? choice.placeholderLabel : null,
        targetSets: DEFAULT_TARGET_SETS,
        groupKey: null,
        notes: null,
        perSet: false,
        sets: ids.lines.slice(0, DEFAULT_TARGET_SETS).map(emptyLine),
        storedPosition: null,
      },
    ],
  }));
}

/** Replace exercise: the slot keeps its sets, prescriptions and group. */
export function replaceSlot<S extends BuilderState>(
  state: S,
  wi: number,
  si: number,
  choice: SlotChoice,
): S {
  return mapSlot(state, wi, si, (s) => ({
    ...s,
    exerciseId: choice.exerciseId ?? null,
    placeholderLabel:
      choice.exerciseId === undefined ? choice.placeholderLabel : null,
  }));
}

/** A target set count as the builder takes it: 1 to `MAX_TARGET_SETS`. */
export function targetSetCount(n: number): number {
  return Math.min(MAX_TARGET_SETS, Math.max(1, Math.round(n)));
}

/**
 * Grows with copies of the last line, or drops lines from the end. Each
 * added line takes the next of `lineIds` (`targetSetCount(n)` of them
 * covers any growth).
 */
export function setTargetSets<S extends BuilderState>(
  state: S,
  wi: number,
  si: number,
  n: number,
  lineIds: readonly string[],
): S {
  const count = targetSetCount(n);
  return mapSlot(state, wi, si, (s) => {
    const last = s.sets[s.sets.length - 1];
    const added = lineIds
      .slice(0, Math.max(0, count - s.sets.length))
      .map((id) => (last ? { ...last, id } : emptyLine(id)));
    const sets = [...s.sets.slice(0, count), ...added];
    return { ...s, targetSets: sets.length, sets };
  });
}

/**
 * "Prescribe each set" on keeps every line as it is; off makes every set
 * the first set's line again (one line for all).
 */
export function setPerSet<S extends BuilderState>(
  state: S,
  wi: number,
  si: number,
  perSet: boolean,
): S {
  return mapSlot(state, wi, si, (s) => {
    if (perSet) return { ...s, perSet };
    const first = s.sets[0]!;
    return {
      ...s,
      perSet,
      sets: s.sets.map((l) => ({ ...first, id: l.id })),
    };
  });
}

export type LinePatch = Partial<
  Pick<
    SetLine,
    "repsMin" | "repsMax" | "weight" | "weightUnit" | "effortKind" | "effort"
  >
>;

/**
 * Edit set `line` (0-based), or every set with `"all"`. A newly typed weight
 * is written in `unit`: the slot exercise's (its override, else the
 * default).
 */
export function updateLine<S extends BuilderState>(
  state: S,
  wi: number,
  si: number,
  line: number | "all",
  patch: LinePatch,
  unit: WeightUnit,
): S {
  return mapSlot(state, wi, si, (s) => ({
    ...s,
    sets: s.sets.map((l, i) => {
      if (line !== "all" && i !== line) return l;
      const next = { ...l, ...patch };
      // A weight is always written in a unit (operations.md 3.4).
      if (next.weight !== null && next.weightUnit === null) {
        next.weightUnit = unit;
      }
      return next;
    }),
  }));
}

export function setSlotNotes<S extends BuilderState>(
  state: S,
  wi: number,
  si: number,
  notes: string | null,
): S {
  return mapSlot(state, wi, si, (s) => ({ ...s, notes }));
}

export function removeSlot<S extends BuilderState>(
  state: S,
  wi: number,
  si: number,
): S {
  return mapWorkout(state, wi, (w) => ({
    ...w,
    slots: normalizeGroups(w.slots.filter((_, i) => i !== si)),
  }));
}

/** Moves slot `from` to index `to` within its workout. */
export function moveSlot<S extends BuilderState>(
  state: S,
  wi: number,
  from: number,
  to: number,
): S {
  return mapWorkout(state, wi, (w) => {
    if (from === to || to < 0 || to >= w.slots.length) return w;
    const slots = [...w.slots];
    const [s] = slots.splice(from, 1);
    slots.splice(to, 0, s!);
    return { ...w, slots: normalizeGroups(slots) };
  });
}

/**
 * "Superset with next": the next slot joins this slot's group (its own
 * group, if it had one, comes along); a slot with no group starts one.
 */
export function supersetWithNext<S extends BuilderState>(
  state: S,
  wi: number,
  si: number,
): S {
  return mapWorkout(state, wi, (w) => {
    const self = w.slots[si];
    const next = w.slots[si + 1];
    if (!self || !next) return w;
    const used = w.slots.flatMap((s) =>
      s.groupKey === null ? [] : [s.groupKey],
    );
    const key = self.groupKey ?? Math.max(0, ...used) + 1;
    const joining = next.groupKey;
    const slots = w.slots.map((s, i) =>
      i === si || i === si + 1 || (joining !== null && s.groupKey === joining)
        ? { ...s, groupKey: key }
        : s,
    );
    return { ...w, slots: normalizeGroups(slots) };
  });
}

/** Takes one slot out of its superset; a group left with one slot ends. */
export function ungroup<S extends BuilderState>(
  state: S,
  wi: number,
  si: number,
): S {
  return mapWorkout(state, wi, (w) => ({
    ...w,
    slots: normalizeGroups(
      w.slots.map((s, i) => (i === si ? { ...s, groupKey: null } : s)),
    ),
  }));
}

/**
 * A superset is a run of adjacent slots. After a move or removal: a slot
 * left alone loses its key, and a group split in two becomes two groups.
 */
export function normalizeGroups(slots: readonly Slot[]): Slot[] {
  const used = new Set<number>();
  let fresh = Math.max(0, ...slots.map((s) => s.groupKey ?? 0));
  const out: Slot[] = [];
  let i = 0;
  while (i < slots.length) {
    const key = slots[i]!.groupKey;
    let j = i + 1;
    while (key !== null && j < slots.length && slots[j]!.groupKey === key) j++;
    const run = slots.slice(i, j);
    if (key === null || run.length < 2) {
      out.push(
        ...run.map((s) => (s.groupKey === null ? s : { ...s, groupKey: null })),
      );
    } else {
      const k = used.has(key) ? ++fresh : key;
      used.add(k);
      out.push(
        ...run.map((s) => (s.groupKey === k ? s : { ...s, groupKey: k })),
      );
    }
    i = j;
  }
  return out;
}

/**
 * After a stale refusal and a reload (D7): the lifter's draft, re-based on
 * the cycle as it now stands. The fingerprint read with it becomes the new
 * baseline (D17), and every workout trained since is replaced by the stored
 * one (frozen), put back in its place if the draft had removed it.
 * Everything else the lifter wrote is kept.
 */
export function rebase<S extends EditState>(
  state: S,
  fresh: CycleDetailResponse,
): S {
  const stored = [...fresh.cycle.workouts].sort(
    (a, b) => a.position - b.position,
  );
  const trained = new Map(
    stored.filter((w) => w.trained).map((w) => [w.id, w]),
  );
  const freeze = (w: StoredWorkout): DraftWorkout => {
    const node = storedNode(w);
    return {
      id: w.id,
      name: w.name,
      notes: w.notes,
      storedPosition: w.position,
      slots: [],
      frozen: node,
      trainedAt: w.trainedAt,
    };
  };
  const workouts = state.workouts.map((w) => {
    const now = trained.get(w.id);
    return now ? freeze(now) : w;
  });
  for (const w of stored) {
    if (!w.trained || workouts.some((x) => x.id === w.id)) continue;
    const at = workouts.findIndex(
      (x) => x.storedPosition !== null && x.storedPosition > w.position,
    );
    workouts.splice(at < 0 ? workouts.length : at, 0, freeze(w));
  }
  return { ...state, baseline: fresh.fingerprint, workouts };
}
