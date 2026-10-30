import { describe, expect, it } from "vitest";
import { openLocalDb } from "../local/db.js";
import { hasLastUser } from "./last-user-hint.js";

let n = 0;
const freshName = () => `hint-${++n}-${Math.random()}`;

describe("hasLastUser", () => {
  it("is false on a device nobody has signed in on", async () => {
    expect(await hasLastUser(freshName())).toBe(false);
  });

  it("is true once a sign-in is recorded, and closes its connection", async () => {
    const name = freshName();
    const db = await openLocalDb(name);
    await db.put(
      "meta",
      { userId: "user_1", email: null, recordedAt: "2026-10-29T10:00:00Z" },
      "lastUser",
    );
    db.close();

    expect(await hasLastUser(name)).toBe(true);
    // A version change would be blocked by a connection left open.
    const upgraded = await new Promise<boolean>((resolve) => {
      const request = indexedDB.open(name, 2);
      request.onblocked = () => resolve(false);
      request.onsuccess = () => {
        request.result.close();
        resolve(true);
      };
    });
    expect(upgraded).toBe(true);
  });

  it("is false when storage can't be opened", async () => {
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = () => {
      throw new Error("no storage in private mode");
    };
    try {
      expect(await hasLastUser(freshName())).toBe(false);
    } finally {
      indexedDB.open = open;
    }
  });
});
