// Builders shared by the step-4a contract tests (programs.test.ts,
// exercises.test.ts): a fully spelled-out cycle tree, and a way to read every
// message a failed parse produced.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { newId } from "../src/index";

export const FP = "a".repeat(64);
export const FP2 = "b".repeat(64);
export const SQUAT = randomUUID(); // catalog ids are echoed, any UUID version

/** Every message a failed parse produced. */
export function messages(schema: z.ZodType, value: unknown): string[] {
  const result = schema.safeParse(value);
  assert.equal(result.success, false, "expected the parse to fail");
  return result.error.issues.map((i) => i.message);
}

export function set(setNumber: number, patch: Record<string, unknown> = {}) {
  return {
    id: newId(),
    setNumber,
    targetRepsMin: 8,
    targetRepsMax: 12,
    targetWeight: 135,
    weightUnit: "LB",
    targetDurationSeconds: null,
    targetDistance: null,
    distanceUnit: null,
    targetRpe: null,
    targetRir: null,
    notes: null,
    ...patch,
  };
}

export type PlannedSet = ReturnType<typeof set>;
export interface Slot {
  id: string;
  exerciseId: string | null;
  placeholderLabel: string | null;
  position: number;
  targetSets: number;
  groupKey: number | null;
  notes: string | null;
  plannedSets: PlannedSet[];
}
export interface Cycle {
  id: string;
  workouts: {
    id: string;
    name: string;
    position: number;
    notes: string | null;
    plannedExercises: Slot[];
  }[];
}

/** A fully spelled-out cycle: Bench Day (3 slots), Leg Day (1 slot). */
export function fullCycle(): Cycle {
  return {
    id: newId(),
    workouts: [
      {
        id: newId(),
        name: "Bench Day",
        position: 0,
        notes: "Rest 2-3 min",
        plannedExercises: [
          {
            id: newId(),
            exerciseId: randomUUID(),
            placeholderLabel: null,
            position: 0,
            targetSets: 4,
            groupKey: null,
            notes: null,
            plannedSets: [set(1), set(2), set(3, { targetRir: 2 })],
          },
          {
            id: newId(),
            exerciseId: randomUUID(),
            placeholderLabel: null,
            position: 1,
            targetSets: 3,
            groupKey: 1,
            notes: null,
            plannedSets: [set(1), set(2), set(3)],
          },
          {
            id: newId(),
            exerciseId: null,
            placeholderLabel: "do something that feels good",
            position: 2,
            targetSets: 3,
            groupKey: 1,
            notes: "anything",
            plannedSets: [],
          },
        ],
      },
      {
        id: newId(),
        name: "Leg Day",
        position: 1,
        notes: null,
        plannedExercises: [
          {
            id: newId(),
            exerciseId: SQUAT,
            placeholderLabel: null,
            position: 0,
            targetSets: 2,
            groupKey: null,
            notes: null,
            plannedSets: [
              set(1, {
                targetRepsMin: null,
                targetRepsMax: null,
                targetWeight: null,
                weightUnit: null,
                targetDurationSeconds: 60,
                targetDistance: 400.5,
                distanceUnit: "M",
                targetRpe: 7.5,
                notes: "easy",
              }),
            ],
          },
        ],
      },
    ],
  };
}

/** fullCycle with Bench Day's slot `index` (0-based) patched. */
export function withSlot(index: number, patch: Partial<Slot>): Cycle {
  const c = fullCycle();
  const w = c.workouts[0]!;
  w.plannedExercises[index] = { ...w.plannedExercises[index]!, ...patch };
  return c;
}
