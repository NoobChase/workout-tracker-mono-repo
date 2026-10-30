// Name rules, in one module (design D9 of step-4a-program-builder).
//
// Programs: `UNIQUE (user_id, name)`, exact. Copy and template start pick a
// free name automatically (operations.md 3.9); manual create and rename are
// refused with the clash named. The constraint is the backstop for a race,
// and `transact` translates it.
//
// Exercises: a custom exercise's name may not match, ignoring case, any
// exercise the user can see -- their own, retired ones included, and the
// standard ones. The database's two partial indexes cover own-vs-own and
// standard-vs-standard only; a custom exercise shadowing a standard name is
// stopped here (data-model.md 3.3).
import { and, eq, ne, sql } from "drizzle-orm";
import {
  exercises,
  userScope,
  workoutPrograms,
  type Tx,
  type UserId,
} from "@workout-tracker/db";
import { conflict } from "./errors";

/**
 * How a program write picks its name (D9): "exact" stores the requested name
 * and refuses a clash (manual create); "free" stores the first free one of
 * "Name", "Name (2)", "Name (3)"... (copy, template start).
 */
export type ProgramNameMode = "exact" | "free";

/**
 * The name a new program is stored under, per `mode`. Run inside the
 * transaction that writes it.
 */
export async function programNameFor(
  tx: Tx,
  user: UserId,
  requested: string,
  mode: ProgramNameMode,
): Promise<string> {
  if (mode === "free") return freeProgramName(tx, user, requested);
  await assertProgramNameFree(tx, user, requested);
  return requested;
}

/**
 * Whether `stored` is a name `programNameFor(requested, mode)` could have
 * picked: `requested` itself, or under "free" also "requested (n)", n >= 2 --
 * the inverse of `freeProgramName`. How a replay recognises its own program
 * (design D17).
 */
export function programNameMatches(
  mode: ProgramNameMode,
  stored: string,
  requested: string,
): boolean {
  if (stored === requested) return true;
  if (mode === "exact") return false;
  const prefix = `${requested} (`;
  if (!stored.startsWith(prefix) || !stored.endsWith(")")) return false;
  const n = stored.slice(prefix.length, -1);
  return /^[1-9][0-9]*$/.test(n) && Number(n) >= 2;
}

/**
 * `base`, or the first free "base (n)" from 2 up, among the user's programs.
 * Run inside the transaction that writes the name.
 */
export async function freeProgramName(
  tx: Tx,
  user: UserId,
  base: string,
): Promise<string> {
  const rows = await tx
    .select({ name: workoutPrograms.name })
    .from(workoutPrograms)
    .where(userScope(user).workoutPrograms);
  const taken = new Set(rows.map((r) => r.name));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Refuses `name` if another of the user's programs already has it, exactly.
 * `exceptProgramId` is the program being renamed: keeping its own name is
 * not a clash.
 */
export async function assertProgramNameFree(
  tx: Tx,
  user: UserId,
  name: string,
  exceptProgramId?: string,
): Promise<void> {
  const [clash] = await tx
    .select({ name: workoutPrograms.name })
    .from(workoutPrograms)
    .where(
      and(
        userScope(user).workoutPrograms,
        eq(workoutPrograms.name, name),
        exceptProgramId === undefined
          ? undefined
          : ne(workoutPrograms.id, exceptProgramId),
      ),
    )
    .limit(1);
  if (clash) {
    throw conflict(`You already have a program named "${clash.name}".`);
  }
}

/**
 * Refuses `name` if it matches, ignoring case, an exercise the user can see:
 * standard, or their own (retired ones still hold their names). The message
 * names the existing exercise as it is stored ("Back Squat" for "back
 * squat"). `exceptExerciseId` is the exercise being renamed.
 */
export async function assertExerciseNameFree(
  tx: Tx,
  user: UserId,
  name: string,
  exceptExerciseId?: string,
): Promise<void> {
  const [clash] = await tx
    .select({ name: exercises.name })
    .from(exercises)
    .where(
      and(
        userScope(user).visibleExercises,
        sql`lower(${exercises.name}) = lower(${name})`,
        exceptExerciseId === undefined
          ? undefined
          : ne(exercises.id, exceptExerciseId),
      ),
    )
    .limit(1);
  if (clash) throw conflict(`"${clash.name}" already exists.`);
}
