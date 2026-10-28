import { describe, expect, it } from "vitest";
import type { QueueItem, QueueOp } from "../local/queue.js";
import { summarizeQueue } from "./queue-summary.js";

let seq = 0;
function item(
  op: QueueOp,
  path: `/api/${string}`,
  failure: QueueItem["failure"] = null,
  sessionId = "s1",
): QueueItem {
  seq += 1;
  return {
    seq,
    op,
    request: { method: "PUT", path },
    sessionId,
    affects: [],
    userId: "u1",
    enqueuedAt: "2026-10-26T09:00:00.000Z",
    attempts: 0,
    failure,
  };
}

describe("summarizeQueue", () => {
  it("counts sets, not writes: a set logged then edited is one set", () => {
    const summary = summarizeQueue([
      item("start", "/api/sessions/s1"),
      item("log", "/api/sets/a"),
      item("edit", "/api/sets/a"),
      item("log", "/api/sets/b"),
      item("delete", "/api/sets/c"),
    ]);
    expect(summary).toEqual({ sets: 3, workout: true, blocked: null });
  });

  it("a finish alone is the workout, with no sets", () => {
    expect(summarizeQueue([item("finish", "/api/sessions/s1/finish")])).toEqual(
      { sets: 0, workout: true, blocked: null },
    );
  });

  it("names the rejected head: its session, op and set", () => {
    const rejected = {
      kind: "rejected",
      status: 422,
      reason: "No.",
      at: "2026-10-26T09:01:00.000Z",
    } as const;
    expect(
      summarizeQueue([
        item("log", "/api/sets/a", rejected),
        item("log", "/api/sets/b"),
      ]).blocked,
    ).toEqual({ sessionId: "s1", op: "log", setId: "a", status: 422 });
    expect(
      summarizeQueue([item("start", "/api/sessions/s1", rejected)]).blocked,
    ).toEqual({ sessionId: "s1", op: "start", setId: null, status: 422 });
  });

  it("an empty queue is nothing", () => {
    expect(summarizeQueue([])).toEqual({
      sets: 0,
      workout: false,
      blocked: null,
    });
  });

  it("names a rejected lane even when another session's writes are ahead of it", () => {
    const rejected = {
      kind: "rejected" as const,
      status: 409,
      reason: "Set 1 is already logged.",
      at: "2026-10-26T09:00:00.000Z",
    };
    const summary = summarizeQueue([
      item("log", "/api/sets/x", null, "s-other"),
      item("log", "/api/sets/r", rejected, "s-rejected"),
    ]);
    expect(summary.blocked).toEqual({
      sessionId: "s-rejected",
      op: "log",
      setId: "r",
      status: 409,
    });
  });
});
