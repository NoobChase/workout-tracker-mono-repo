// Design D9 (src/names.ts), against a real Neon branch.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { UserId } from "@workout-tracker/db";
import { transact } from "../src/errors";
import {
  assertExerciseNameFree,
  assertProgramNameFree,
  freeProgramName,
  programNameMatches,
} from "../src/names";
import { cleanup, db, newId, newUser, pool, rejectsWith } from "./db";

after(cleanup);

async function addProgram(user: UserId, name: string): Promise<string> {
  const id = newId();
  await pool.query(
    "INSERT INTO workout_programs (id, user_id, name) VALUES ($1, $2, $3)",
    [id, user, name],
  );
  return id;
}

async function addExercise(
  user: UserId,
  name: string,
  isActive = true,
): Promise<string> {
  const id = newId();
  await pool.query(
    "INSERT INTO exercises (id, owner_user_id, name, is_active) VALUES ($1, $2, $3, $4)",
    [id, user, name, isActive],
  );
  return id;
}

describe("freeProgramName", () => {
  it("keeps a free name, then suffixes (2), then (3)", async () => {
    const user = await newUser();
    const free = (base: string) =>
      transact(db, (tx) => freeProgramName(tx, user, base));

    assert.equal(await free("Summer Strength"), "Summer Strength");
    await addProgram(user, "Summer Strength");
    assert.equal(await free("Summer Strength"), "Summer Strength (2)");
    await addProgram(user, "Summer Strength (2)");
    assert.equal(await free("Summer Strength"), "Summer Strength (3)");
  });

  it("ignores another user's programs", async () => {
    const other = await newUser();
    await addProgram(other, "Base Building");
    const user = await newUser();
    assert.equal(
      await transact(db, (tx) => freeProgramName(tx, user, "Base Building")),
      "Base Building",
    );
  });
});

describe("programNameMatches", () => {
  it("exact: only the name itself", () => {
    assert.equal(programNameMatches("exact", "PPL", "PPL"), true);
    assert.equal(programNameMatches("exact", "PPL (2)", "PPL"), false);
  });

  it("free: the name or any name freeProgramName could pick for it", () => {
    for (const stored of ["PPL", "PPL (2)", "PPL (17)"]) {
      assert.equal(programNameMatches("free", stored, "PPL"), true, stored);
    }
    for (const stored of [
      "PPL (1)",
      "PPL (02)",
      "PPL (x)",
      "PPL 2",
      "PPL (2) (3)",
      "ppl",
      "Other",
    ]) {
      assert.equal(programNameMatches("free", stored, "PPL"), false, stored);
    }
  });
});

describe("assertProgramNameFree", () => {
  it("refuses an exact clash, naming it", async () => {
    const user = await newUser();
    await addProgram(user, "Summer Strength");
    const error = await rejectsWith(
      transact(db, (tx) => assertProgramNameFree(tx, user, "Summer Strength")),
      "conflict",
    );
    assert.equal(
      error.message,
      'You already have a program named "Summer Strength".',
    );
  });

  it("allows a name differing only in case, as the unique does", async () => {
    const user = await newUser();
    await addProgram(user, "Summer Strength");
    await transact(db, (tx) =>
      assertProgramNameFree(tx, user, "summer strength"),
    );
  });

  it("lets a program keep its own name, and ignores other users", async () => {
    const user = await newUser();
    const id = await addProgram(user, "Winter Base");
    await transact(db, (tx) =>
      assertProgramNameFree(tx, user, "Winter Base", id),
    );
    const other = await newUser();
    await transact(db, (tx) => assertProgramNameFree(tx, other, "Winter Base"));
  });
});

describe("assertExerciseNameFree", () => {
  it("refuses a standard exercise's name in any case, naming it as stored", async () => {
    const user = await newUser();
    for (const name of ["back squat", "BACK SQUAT", "Back Squat"]) {
      const error = await rejectsWith(
        transact(db, (tx) => assertExerciseNameFree(tx, user, name)),
        "conflict",
      );
      assert.equal(error.message, '"Back Squat" already exists.', name);
    }
  });

  it("refuses the name of the user's own exercise, retired ones included", async () => {
    const user = await newUser();
    await addExercise(user, "Reverse Hyper");
    await addExercise(user, "Zercher Squat", false);
    for (const [name, stored] of [
      ["reverse HYPER", "Reverse Hyper"],
      ["zercher squat", "Zercher Squat"],
    ] as const) {
      const error = await rejectsWith(
        transact(db, (tx) => assertExerciseNameFree(tx, user, name)),
        "conflict",
      );
      assert.equal(error.message, `"${stored}" already exists.`);
    }
  });

  it("ignores another user's exercises and the exercise being renamed", async () => {
    const other = await newUser();
    await addExercise(other, "Jefferson Curl");
    const user = await newUser();
    await transact(db, (tx) =>
      assertExerciseNameFree(tx, user, "jefferson curl"),
    );
    const mine = await addExercise(user, "Reverse Hyper");
    await transact(db, (tx) =>
      assertExerciseNameFree(tx, user, "REVERSE HYPER", mine),
    );
  });
});
