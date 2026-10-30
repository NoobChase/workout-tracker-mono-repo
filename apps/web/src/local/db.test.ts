import { openDB } from "idb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { freshDbName, makeHarness, type Harness } from "../test/fakes.js";
import { onLocalDbEvent, openLocalDb, type LocalDbEvent } from "./db.js";

/*
 * Opening across versions (a tab left open over a deploy): an open
 * connection never holds a newer version's upgrade waiting, and an open
 * that has to wait on an older tab says so and carries on once it goes.
 */

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const undo of cleanup.splice(0)) undo();
});

function record() {
  const events: LocalDbEvent[] = [];
  cleanup.push(onLocalDbEvent((e) => events.push(e)));
  return events;
}

describe("openLocalDb across versions", () => {
  it("closes itself when a newer version opens, so that open never hangs", async () => {
    const name = freshDbName();
    const events = record();
    const current = await openLocalDb(name);

    // A later deploy's version 3, opened in another tab.
    const next = await openDB(name, 3);
    expect(next.version).toBe(3);
    expect(events).toEqual([{ kind: "replaced", name }]);
    // The old connection is closed: it can't be used any more.
    expect(() => current.transaction("meta")).toThrow();
    next.close();
  });

  it("stops the data layer's queue when its storage is replaced", async () => {
    const h: Harness = await makeHarness();
    cleanup.push(() => h.layer.close());
    const close = vi.spyOn(h.layer, "close");
    const next = await openDB(h.dbName, 3);
    expect(next.version).toBe(3);
    expect(close).toHaveBeenCalledOnce();
    // Closed with its queue stopped: reads refuse instead of hanging.
    await expect(h.layer.db.get("meta", "lastUser")).rejects.toThrow();
    next.close();
  });

  it("waits on an older tab that won't let go, says so, and carries on once it closes", async () => {
    const name = freshDbName();
    const events = record();
    // A step-3 tab: version 1, with no versionchange handling.
    const old = await openDB(name, 1, {
      upgrade(db) {
        db.createObjectStore("meta");
        db.createObjectStore("queue", { keyPath: "seq", autoIncrement: true });
        db.createObjectStore("sessions", { keyPath: "sessionId" });
        db.createObjectStore("contexts", { keyPath: "workoutId" });
      },
    });
    let opened = false;
    const opening = openLocalDb(name).then((db) => {
      opened = true;
      return db;
    });
    await expect.poll(() => events).toEqual([{ kind: "blocked", name }]);
    expect(opened).toBe(false);

    old.close();
    const db = await opening;
    expect(db.version).toBe(2);
    expect([...db.objectStoreNames]).toContain("drafts");
    db.close();
  });
});
