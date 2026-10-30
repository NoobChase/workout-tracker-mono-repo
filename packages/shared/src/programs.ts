// The program builder's and program lifecycle's wire contracts (operations.md
// 3.1-3.12; design D3, D4, D7, D8, D10 of
// openspec/changes/step-4a-program-builder).
//
// The cycle tree's field names are the Drizzle schema's (`packages/db`
// src/schema.ts: `workouts`, `plannedExercises`, `plannedSets`), so a tree
// parsed here lines up field for field with the in-memory tree
// `cycleFingerprint` normalizes. Import (4b) reuses `cycleTree` and its
// messages, which is why every message names the workout, slot and set in
// the lifter's words.
import { z } from "zod";
import { entityId, isoDateTime, uuidV7 } from "./ids.js";
import {
  distanceUnit,
  distanceValue,
  durationSeconds,
  repsValue,
  rirValue,
  rpeValue,
  setNumber,
  smallint,
  weightUnit,
  weightValue,
} from "./units.js";

/** Mirrors the `program_status` enum. */
export const programStatus = z.enum([
  "DRAFT",
  "ACTIVE",
  "COMPLETED",
  "ARCHIVED",
]);
export type ProgramStatus = z.infer<typeof programStatus>;

/** A cycle (`workout_plans.cycle_number`), numbered from 1. */
export const cycleNumber = smallint(1);

/** A cycle number as a path segment (`/programs/:id/cycles/:n`): digits only. */
export const cycleNumberParam = z
  .string()
  .regex(/^[1-9][0-9]*$/, "not a cycle number")
  .transform(Number)
  .pipe(cycleNumber);

/** `target_cycles`: a fixed length of at least one cycle, or null for open-ended. */
export const targetCycles = smallint(1).nullable();

/**
 * How big a program the builder accepts (design D17). Generous for any real
 * program, small enough that one create or save stays a modest transaction.
 * Requests only: a stored program extended past `targetCycles` still reads.
 */
export const programLimits = {
  /** Two years of weekly cycles. */
  targetCycles: 104,
  workoutsPerCycle: 14,
  exercisesPerWorkout: 40,
  /** Both a slot's `targetSets` and how many sets it prescribes. */
  setsPerExercise: 30,
  /**
   * Rows one create may write in all: `targetCycles` (1 when open-ended)
   * times the cycle's workouts, slots and prescribed sets. The per-level
   * bounds alone still allow about 1.8 million.
   */
  rowsPerProgram: 20_000,
  /** Fixed length an extend may reach: the same maximum as a create. */
  maxExtendedCycles: 104,
} as const;

/** A requested fixed length: 1 to `programLimits.targetCycles`, or null. */
export const requestedTargetCycles = smallint(1)
  .max(
    programLimits.targetCycles,
    `A program can run at most ${programLimits.targetCycles} cycles. Choose open-ended to keep going.`,
  )
  .nullable();

/** A program's name as typed: trimmed, never empty. */
export const programName = z.string().trim().min(1, "Give the program a name.");

/** `cycleFingerprint`'s output: SHA-256, lowercase hex. */
export const fingerprint = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "not a cycle fingerprint");

const optionalText = z.string().nullable().default(null);

// --- The cycle tree (design D3, D4) -----------------------------------------
//
// Every id is a UUIDv7: new rows are minted by the client, and kept rows echo
// ids the server minted, which are v7 too. Optional columns default to null so
// a client may omit them.

/**
 * A `planned_sets` row: one prescribed set, every target optional. The effort
 * target is RPE or RIR, stored as written and never both (design D16).
 */
export const plannedSetNode = z.object({
  id: uuidV7,
  setNumber,
  targetRepsMin: repsValue.nullable().default(null),
  targetRepsMax: repsValue.nullable().default(null),
  targetWeight: weightValue.nullable().default(null),
  weightUnit: weightUnit.nullable().default(null),
  targetDurationSeconds: durationSeconds.nullable().default(null),
  targetDistance: distanceValue.nullable().default(null),
  distanceUnit: distanceUnit.nullable().default(null),
  targetRpe: rpeValue.nullable().default(null),
  targetRir: rirValue.nullable().default(null),
  notes: optionalText,
});
export type PlannedSetNode = z.infer<typeof plannedSetNode>;

/**
 * A `planned_exercises` row: a slot holding exactly one of an exercise from
 * the user's catalog or a free-text placeholder label (operations.md 3.3,
 * 3.5). `groupKey`: equal values within a workout are one superset, ordered by
 * position; A1/A2 labels are derived, never sent (3.6).
 */
export const plannedExerciseNode = z.object({
  id: uuidV7,
  exerciseId: entityId.nullable().default(null),
  placeholderLabel: z.string().trim().min(1).nullable().default(null),
  position: smallint(0),
  targetSets: smallint(1),
  groupKey: smallint(0).nullable().default(null),
  notes: optionalText,
  plannedSets: z.array(plannedSetNode).default([]),
});
export type PlannedExerciseNode = z.infer<typeof plannedExerciseNode>;

/** A `workouts` row and its slots. Rest guidance lives in `notes`. */
export const workoutNode = z.object({
  id: uuidV7,
  name: z.string().trim().min(1, "Give every workout a name."),
  position: smallint(0),
  notes: optionalText,
  plannedExercises: z.array(plannedExerciseNode).default([]),
});
export type WorkoutNode = z.infer<typeof workoutNode>;

/**
 * A slot's ordinal in its workout, from 1, by position order (array order
 * breaks a tie, which a valid workout never has). `slot` must be one of
 * `workout.plannedExercises`.
 */
export function slotOrdinal(
  workout: { plannedExercises: readonly { position: number }[] },
  slot: { position: number },
): number {
  const slots = workout.plannedExercises;
  const i = slots.indexOf(slot);
  return (
    slots.filter(
      (s, j) =>
        s.position < slot.position || (s.position === slot.position && j < i),
    ).length + 1
  );
}

/**
 * "Push, exercise 2": a slot as the lifter counts it, in every message that
 * names one -- this schema's and the server's.
 */
export function slotLabel(
  workout: {
    name: string;
    plannedExercises: readonly { position: number }[];
  },
  slot: { position: number },
): string {
  return `${workout.name}, exercise ${slotOrdinal(workout, slot)}`;
}

/** Just the ids of a cycle tree, at every level. */
interface IdTree {
  id: string;
  workouts: readonly {
    id: string;
    plannedExercises: readonly {
      id: string;
      plannedSets: readonly { id: string }[];
    }[];
  }[];
}

/**
 * The first id a cycle tree uses twice -- the plan, a workout, a slot or a
 * set -- or undefined. A by-id diff would collapse the two rows silently, so
 * the contract and the services both refuse it (`duplicateIdMessage`).
 */
export function firstDuplicateId(cycle: IdTree): string | undefined {
  const seen = new Set<string>();
  const ids = [
    cycle.id,
    ...cycle.workouts.flatMap((w) => [
      w.id,
      ...w.plannedExercises.flatMap((s) => [
        s.id,
        ...s.plannedSets.map((p) => p.id),
      ]),
    ]),
  ];
  for (const id of ids) {
    if (seen.has(id)) return id;
    seen.add(id);
  }
  return undefined;
}

/** The refusal for `firstDuplicateId`'s find, word for word everywhere. */
export const duplicateIdMessage = (id: string) =>
  `The id ${id} is used twice in this cycle.`;

type Ctx = z.RefinementCtx;

function checkSlot(
  ctx: Ctx,
  slot: PlannedExerciseNode,
  where: string,
  path: (string | number)[],
) {
  const fail = (message: string, sub: (string | number)[] = []) =>
    ctx.addIssue({ code: "custom", message, path: [...path, ...sub] });

  if (slot.exerciseId !== null && slot.placeholderLabel !== null) {
    fail(`${where}: choose an exercise or a placeholder label, not both.`, [
      "placeholderLabel",
    ]);
  } else if (slot.exerciseId === null && slot.placeholderLabel === null) {
    fail(`${where}: choose an exercise or write a placeholder label.`, [
      "exerciseId",
    ]);
  }

  const sets = slot.plannedSets;
  const maxSets = programLimits.setsPerExercise;
  if (slot.targetSets > maxSets) {
    fail(`${where}: the target can be at most ${maxSets} sets.`, [
      "targetSets",
    ]);
  }
  if (sets.length > maxSets) {
    fail(`${where}: at most ${maxSets} sets can be prescribed.`, [
      "plannedSets",
    ]);
  }
  if (sets.length > slot.targetSets) {
    fail(
      `${where}: ${sets.length} sets are prescribed but the target is ${slot.targetSets}.`,
      ["plannedSets"],
    );
  }
  const numbers = new Set(sets.map((s) => s.setNumber));
  const contiguous = sets.every((s) => s.setNumber <= sets.length);
  if (numbers.size !== sets.length || !contiguous) {
    fail(
      `${where}: prescribed sets must be numbered 1 to ${sets.length}, each once.`,
      ["plannedSets"],
    );
  }

  sets.forEach((s, k) => {
    const setWhere = `${where}, set ${s.setNumber}`;
    const at = ["plannedSets", k];
    if (
      s.targetRepsMin !== null &&
      s.targetRepsMax !== null &&
      s.targetRepsMax < s.targetRepsMin
    ) {
      fail(`${setWhere}: rep max is below rep min.`, [...at, "targetRepsMax"]);
    }
    if (s.targetWeight !== null && s.weightUnit === null) {
      fail(`${setWhere}: a weight needs a unit.`, [...at, "weightUnit"]);
    }
    if (s.targetDistance !== null && s.distanceUnit === null) {
      fail(`${setWhere}: a distance needs a unit.`, [...at, "distanceUnit"]);
    }
    if (s.targetRpe !== null && s.targetRir !== null) {
      fail(`${setWhere}: choose an RPE or an RIR target, not both.`, [
        ...at,
        "targetRir",
      ]);
    }
  });
}

/**
 * Cycle n's whole tree, as created (D3) or saved (D4). `id` is the
 * `workout_plans` row. Validation beyond each field's own range:
 *
 * - a cycle has 1 to 14 workouts, and workout positions are distinct;
 * - a workout has at most 40 slots, and their positions are distinct;
 * - a slot's target is at most 30 sets (`programLimits`);
 * - a slot is exactly one of exercise or placeholder label;
 * - a slot prescribes at most `targetSets` sets, numbered 1..n, each once;
 * - a prescribed set's rep max is not below its rep min;
 * - a weight carries its unit, and so does a distance;
 * - a prescribed set carries at most one effort target, RPE or RIR;
 * - no id appears twice anywhere in the tree.
 *
 * Every message names the workout, slot ("exercise 2", by position order) and
 * set as the lifter would ("Bench Day, exercise 2, set 3: rep max is below rep
 * min."). Whether an exercise id is one the user can see is the server's
 * check, not this schema's.
 */
export const cycleTree = z
  .object({
    id: uuidV7,
    workouts: z
      .array(workoutNode)
      .min(1, "A cycle needs at least one workout.")
      .max(
        programLimits.workoutsPerCycle,
        `A cycle can have at most ${programLimits.workoutsPerCycle} workouts.`,
      ),
  })
  .superRefine((cycle, ctx) => {
    const workoutAt = new Map<number, string>();
    cycle.workouts.forEach((w, wi) => {
      const wPath = ["workouts", wi];
      const other = workoutAt.get(w.position);
      if (other !== undefined) {
        ctx.addIssue({
          code: "custom",
          message: `${other} and ${w.name} are in the same place in the cycle.`,
          path: [...wPath, "position"],
        });
      } else {
        workoutAt.set(w.position, w.name);
      }

      if (w.plannedExercises.length > programLimits.exercisesPerWorkout) {
        ctx.addIssue({
          code: "custom",
          message: `${w.name} has ${w.plannedExercises.length} exercises; a workout can have at most ${programLimits.exercisesPerWorkout}.`,
          path: [...wPath, "plannedExercises"],
        });
      }

      const slotAt = new Map<number, number>();
      w.plannedExercises.forEach((slot, si) => {
        const sPath = [...wPath, "plannedExercises", si];
        const ordinal = slotOrdinal(w, slot);
        const clash = slotAt.get(slot.position);
        if (clash !== undefined) {
          ctx.addIssue({
            code: "custom",
            message: `${w.name}: exercises ${clash} and ${ordinal} are in the same place.`,
            path: [...sPath, "position"],
          });
        } else {
          slotAt.set(slot.position, ordinal);
        }
        checkSlot(ctx, slot, slotLabel(w, slot), sPath);
      });
    });

    const duplicate = firstDuplicateId(cycle);
    if (duplicate !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: duplicateIdMessage(duplicate),
        path: [],
      });
    }
  });
export type CycleTree = z.infer<typeof cycleTree>;
/** What a client sends, before defaults fill the omitted nullable columns. */
export type CycleTreeInput = z.input<typeof cycleTree>;

// --- Requests ---------------------------------------------------------------

/** Rows one copy of the cycle writes: its workouts, slots and prescribed sets. */
export function cycleRowCount(cycle: CycleTree): number {
  let rows = 0;
  for (const w of cycle.workouts) {
    rows += 1 + w.plannedExercises.length;
    for (const slot of w.plannedExercises) rows += slot.plannedSets.length;
  }
  return rows;
}

/**
 * `POST /programs` (operations.md 3.1; D3). `programId` and every id in
 * `cycle` are client-minted, so a retried create is recognised. A fixed
 * program materializes `targetCycles` identical cycles; open-ended (null)
 * materializes one.
 */
export const createProgramRequest = z
  .object({
    programId: uuidV7,
    name: programName,
    targetCycles: requestedTargetCycles,
    cycle: cycleTree,
  })
  .superRefine((v, ctx) => {
    const cycles = v.targetCycles ?? 1;
    const perCycle = cycleRowCount(v.cycle);
    const total = cycles * perCycle;
    if (total > programLimits.rowsPerProgram) {
      ctx.addIssue({
        code: "custom",
        message:
          `This program would be too large: ${cycles} ${cycles === 1 ? "cycle" : "cycles"} of ` +
          `${perCycle} workouts, exercises and sets come to ${total}, over the limit of ` +
          `${programLimits.rowsPerProgram}. Use fewer cycles or a smaller cycle.`,
        path: ["cycle"],
      });
    }
  });
export type CreateProgramRequest = z.infer<typeof createProgramRequest>;

/**
 * `PUT /programs/:id/cycles/:n` (operations.md 3.7, 3.8; D4, D7). `cycle` is
 * the whole desired tree, keeping existing ids. `expected.source` is the
 * edited cycle's fingerprint as the builder loaded it (the cycle read's
 * `fingerprint`). `applyTo` is the later cycles to replace with the edited
 * one, each with the fingerprint the apply preview showed for it.
 */
export const saveCycleRequest = z
  .object({
    cycle: cycleTree,
    expected: z.object({ source: fingerprint }),
    applyTo: z.array(z.object({ cycleNumber, fingerprint })),
  })
  .superRefine((v, ctx) => {
    const chosen = new Set(v.applyTo.map((t) => t.cycleNumber));
    if (chosen.size !== v.applyTo.length) {
      ctx.addIssue({
        code: "custom",
        message: "A cycle is chosen twice.",
        path: ["applyTo"],
      });
    }
  });
export type SaveCycleRequest = z.infer<typeof saveCycleRequest>;

/** `POST /programs/:id/copy` (3.9). The name defaults to the source's, suffixed. */
export const copyProgramRequest = z.object({
  newProgramId: uuidV7,
  name: programName.optional(),
});
export type CopyProgramRequest = z.infer<typeof copyProgramRequest>;

/** `PATCH /programs/:id`: rename. An exact clash with another program is refused. */
export const renameProgramRequest = z.object({ name: programName });
export type RenameProgramRequest = z.infer<typeof renameProgramRequest>;

/** `POST /programs/:id/extend` (3.12; D8): idempotent on `newPlanId`. */
export const extendProgramRequest = z.object({ newPlanId: uuidV7 });
export type ExtendProgramRequest = z.infer<typeof extendProgramRequest>;

// --- Responses --------------------------------------------------------------

/**
 * One program with its progress (D10). `currentCycle` is the lowest cycle
 * that still has an unresolved workout, null when every workout is resolved.
 * A fixed program reads "cycle n of `targetCycles`"; open-ended (null) reads
 * "cycle n".
 */
export const programSummary = z.object({
  id: entityId,
  name: z.string(),
  status: programStatus,
  targetCycles,
  currentCycle: cycleNumber.nullable(),
});
export type ProgramSummary = z.infer<typeof programSummary>;

/** `GET /programs`: every program the user owns, whatever its status. */
export const programListResponse = z.object({
  programs: z.array(programSummary),
});
export type ProgramListResponse = z.infer<typeof programListResponse>;

/**
 * Create, copy, rename, activate, archive, extend and template start answer
 * with the program as it now stands.
 */
export const programResponse = z.object({ program: programSummary });
export type ProgramResponse = z.infer<typeof programResponse>;

/** `GET /programs/:id`: the program and its cycles, each flagged if trained. */
export const programDetailResponse = z.object({
  program: programSummary,
  cycles: z.array(
    z.object({
      cycleNumber,
      /** Any of its workouts has a session, of any status (D5). */
      trained: z.boolean(),
      /** Every workout in it has a session, of any status. */
      fullyTrained: z.boolean(),
    }),
  ),
});
export type ProgramDetailResponse = z.infer<typeof programDetailResponse>;

/**
 * `GET /programs/:id/cycles/:n`: the stored tree, each workout flagged if
 * trained (frozen in the editor, D5). The node shapes are the request's, so
 * the builder edits what it read and sends it back; the cross-field rules are
 * not re-run on what is already stored.
 *
 * `fingerprint` is the stored cycle's, read in the same snapshot as the tree.
 * The builder sends it back as the save's `expected.source`, so a save from
 * another device between this read and the save is refused as stale (design
 * D7).
 */
export const cycleDetailResponse = z.object({
  programId: entityId,
  cycleNumber,
  fingerprint,
  cycle: z.object({
    id: entityId,
    workouts: z.array(
      workoutNode.extend({
        trained: z.boolean(),
        /**
         * The earliest `performed_at` of any session against the workout,
         * whatever its status (the D5 "trained" definition); null untrained.
         */
        trainedAt: isoDateTime.nullable(),
      }),
    ),
  }),
});
export type CycleDetailResponse = z.infer<typeof cycleDetailResponse>;

/**
 * `GET /programs/:id/cycles/:n/apply-preview` (D7): the edited cycle's
 * fingerprint before the edit, and every later cycle's status. The client
 * pre-selects `matches && !trained`, annotates `!matches` as looking
 * intentionally different, and locks `trained`.
 */
export const applyPreviewResponse = z.object({
  cycleNumber,
  source: fingerprint,
  later: z.array(
    z.object({
      cycleNumber,
      fingerprint,
      trained: z.boolean(),
      matches: z.boolean(),
    }),
  ),
});
export type ApplyPreviewResponse = z.infer<typeof applyPreviewResponse>;

/**
 * `PUT /programs/:id/cycles/:n` response: the edited cycle and the later
 * cycles it was applied to. A retried save that finds its effect already in
 * place answers the same and writes nothing.
 */
export const saveCycleResponse = z.object({
  cycleNumber,
  applied: z.array(cycleNumber),
});
export type SaveCycleResponse = z.infer<typeof saveCycleResponse>;
