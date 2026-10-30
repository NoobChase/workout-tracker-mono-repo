import { newId } from "@workout-tracker/shared";
import { openDB } from "idb";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { freshDbName, makeHarness, USER, type Harness } from "../test/fakes.js";
import { openLocalDb } from "./db.js";

let harnesses: Harness[] = [];
afterEach(() => {
  for (const h of harnesses) h.layer.close();
  harnesses = [];
});
async function harness(dbName?: string) {
  const h = await makeHarness(dbName ? { dbName } : {});
  harnesses.push(h);
  return h;
}

/** A stand-in for the builder's versioned draft (`builder/draft.ts`). */
const named = z.object({ version: z.literal(1), name: z.string() });
const anything = z.unknown();

describe("builder drafts (step 4a D14)", () => {
  it("keeps a draft per program and cycle across a reload, until deleted", async () => {
    const program = newId();
    const h = await harness();
    await h.layer.drafts.put(USER, program, 3, {
      version: 1,
      name: "cycle three",
    });
    await h.layer.drafts.put(USER, null, 1, { version: 1, name: "new one" });
    h.layer.close();
    harnesses = [];

    const again = await harness(h.dbName);
    const draft = await again.layer.drafts.get(named, USER, program, 3);
    expect(draft?.state).toEqual({ version: 1, name: "cycle three" });
    expect(draft?.savedAt).toBe("2026-10-26T09:00:00.000Z");
    expect(
      await again.layer.drafts.get(named, USER, program, 4),
    ).toBeUndefined();
    expect((await again.layer.drafts.get(named, USER, null, 1))?.state).toEqual(
      { version: 1, name: "new one" },
    );

    await again.layer.drafts.delete(USER, program, 3);
    expect(
      await again.layer.drafts.get(named, USER, program, 3),
    ).toBeUndefined();
  });

  it("discards a draft that no longer parses (an older build's), rather than handing it to the builder", async () => {
    const program = newId();
    const h = await harness();
    await h.layer.drafts.put(USER, program, 1, { name: "unversioned" });

    expect(await h.layer.drafts.get(named, USER, program, 1)).toBeUndefined();
    // Gone, not just skipped: no schema reads it again.
    expect(
      await h.layer.drafts.get(anything, USER, program, 1),
    ).toBeUndefined();
  });

  it("never reads another account's draft", async () => {
    const program = newId();
    const h = await harness();
    await h.layer.drafts.put(USER, program, 1, { mine: true });
    expect(
      await h.layer.drafts.get(anything, "user_other", program, 1),
    ).toBeUndefined();
  });

  it("forgets another account's drafts on every sign-in, even after a sign-out cleared the record", async () => {
    const program = newId();
    const h = await harness();
    await h.layer.drafts.put(USER, program, 1, { mine: true });
    // Signing out clears the last-user record, so no previous user is known.
    await h.layer.signedOut();
    expect(h.layer.lastUser.getSnapshot()).toBeNull();

    await h.layer.signedIn({ userId: "user_other", email: null });
    expect(
      await h.layer.drafts.get(anything, USER, program, 1),
    ).toBeUndefined();

    // Signing the same account in again keeps its own drafts.
    await h.layer.drafts.put("user_other", program, 1, { theirs: true });
    await h.layer.signedIn({ userId: "user_other", email: "x@example.com" });
    expect(
      (await h.layer.drafts.get(anything, "user_other", program, 1))?.state,
    ).toEqual({ theirs: true });
  });

  it("upgrading a step-3 database keeps what it holds, the queue included", async () => {
    const name = freshDbName();
    const v1 = await openDB(name, 1, {
      upgrade(db) {
        db.createObjectStore("meta");
        db.createObjectStore("queue", { keyPath: "seq", autoIncrement: true });
        db.createObjectStore("sessions", { keyPath: "sessionId" });
        db.createObjectStore("contexts", { keyPath: "workoutId" });
      },
    });
    await v1.put(
      "meta",
      { userId: USER, email: null, recordedAt: "x" },
      "lastUser",
    );
    await v1.add("queue", { op: "start", sessionId: "s1" });
    v1.close();

    const db = await openLocalDb(name);
    expect(db.version).toBe(2);
    expect(await db.get("meta", "lastUser")).toMatchObject({ userId: USER });
    expect(await db.getAll("queue")).toEqual([
      { op: "start", sessionId: "s1", seq: 1 },
    ]);
    expect(await db.getAll("drafts")).toEqual([]);
    db.close();
  });
});
