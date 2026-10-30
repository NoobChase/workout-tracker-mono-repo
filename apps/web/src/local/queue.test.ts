import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ApiError, NetworkError } from "../api.js";
import { AuthNotReadyError, OfflineError } from "../auth.js";
import { FakeServer, makeHarness, USER, type Harness } from "../test/fakes.js";
import {
  backoffMs,
  classify,
  RequestTimeoutError,
  type QueueItemInput,
} from "./queue.js";
import { summarize } from "./sync-state.js";

let harnesses: Harness[] = [];
async function harness(...args: Parameters<typeof makeHarness>) {
  const h = await makeHarness(...args);
  harnesses.push(h);
  return h;
}
afterEach(() => {
  for (const h of harnesses) h.layer.close();
  harnesses = [];
});

function item(n: number): QueueItemInput {
  return {
    op: "edit",
    request: { method: "PATCH", path: `/api/sets/item-${n}`, body: { n } },
    sessionId: "s1",
    affects: [`item-${n}`],
    userId: USER,
  };
}

/** An item in session `lane`, made by `userId`. */
function laneItem(lane: string, n: number, userId = USER): QueueItemInput {
  return {
    op: "edit",
    request: { method: "PATCH", path: `/api/sets/${lane}-${n}`, body: { n } },
    sessionId: lane,
    affects: [`${lane}-${n}`],
    userId,
  };
}

const paths = (h: Harness) => h.server.calls.map((c) => c.request.path);

describe("mutation queue", () => {
  it("delivers in enqueue order, one at a time", async () => {
    const h = await harness();
    h.server.failWith = () => null;
    h.server.apply = () => undefined;
    h.connectivity.online = false; // collect a backlog first
    for (const n of [1, 2, 3, 4, 5]) await h.layer.queue.enqueue(item(n));
    await h.layer.queue.settled();
    expect(h.layer.queue.getState().items.map((i) => i.request.path)).toEqual(
      [1, 2, 3, 4, 5].map((n) => `/api/sets/item-${n}`),
    );

    h.connectivity.set(true); // the `online` event is a flush trigger
    await h.layer.queue.settled();
    expect(paths(h).slice(-5)).toEqual(
      [1, 2, 3, 4, 5].map((n) => `/api/sets/item-${n}`),
    );
    expect(h.layer.queue.getState().items).toEqual([]);
  });

  it("never sends a later write before an earlier one is acknowledged", async () => {
    const h = await harness();
    h.server.apply = () => undefined;
    h.server.holdNext = true; // item 1 stays on the wire
    await h.layer.queue.enqueue(item(1));
    await waitFor(() => expect(paths(h)).toEqual(["/api/sets/item-1"]));
    expect(h.layer.queue.getState().sendingSeq).not.toBeNull();

    // Set 4 is logged just as signal returns: it must wait for set 3.
    await h.layer.queue.enqueue(item(2));
    h.connectivity.set(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(paths(h)).toEqual(["/api/sets/item-1"]);

    h.server.release();
    await h.layer.queue.settled();
    expect(paths(h)).toEqual(["/api/sets/item-1", "/api/sets/item-2"]);
    expect(h.layer.queue.getState().items).toEqual([]);
  });

  it("refreshes the token on a 401 and resends at once", async () => {
    const h = await harness();
    h.server.apply = () => undefined;
    h.server.failWith = (_, refreshToken) =>
      refreshToken ? null : new ApiError(401, "/api/sets/item-1", null);
    await h.layer.queue.enqueue(item(1));
    await h.layer.queue.settled();
    expect(h.server.calls.map((c) => c.refreshToken)).toEqual([false, true]);
    expect(h.layer.queue.getState().items).toEqual([]);
    expect(h.timers.scheduled).toEqual([]);
  });

  it("backs off when a fresh token is refused too", async () => {
    const h = await harness();
    h.server.failWith = () => new ApiError(401, "/api/sets/item-1", null);
    await h.layer.queue.enqueue(item(1));
    await h.layer.queue.settled();
    const [head] = h.layer.queue.getState().items;
    expect(head?.failure).toMatchObject({
      kind: "retry",
      cause: "auth",
      status: 401,
    });
    expect(h.timers.scheduled).toEqual([1000]);
  });

  it("retries a 5xx with backoff from 1s, doubling, until it is accepted", async () => {
    const h = await harness();
    let failures = 3;
    h.server.apply = () => undefined;
    h.server.failWith = () =>
      failures-- > 0 ? new ApiError(503, "/api/sets/item-1", null) : null;
    await h.layer.queue.enqueue(item(1));
    await h.layer.queue.settled();

    const state = () => h.layer.queue.getState();
    expect(summarize(state(), true)).toMatchObject({
      state: "retrying",
      pending: 1,
    });
    for (let i = 0; i < 3; i++) {
      h.timers.fire();
      await h.layer.queue.settled();
    }
    expect(h.timers.scheduled).toEqual([1000, 2000, 4000]);
    expect(h.server.calls).toHaveLength(4);
    expect(state().items).toEqual([]);
    expect(summarize(state(), true)).toEqual({ state: "synced", pending: 0 });
  });

  it("says no signal, not synced, when offline with nothing queued", async () => {
    const h = await harness();
    expect(summarize(h.layer.queue.getState(), true)).toEqual({
      state: "synced",
      pending: 0,
    });
    expect(summarize(h.layer.queue.getState(), false)).toEqual({
      state: "offline",
      pending: 0,
    });
  });

  it("caps the backoff at 30s", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(backoffMs)).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000,
    ]);
  });

  it("classifies every failure into retry, refresh or rejected", () => {
    const api = (status: number) => new ApiError(status, "/api/x", "nope");
    expect(classify(new OfflineError())).toMatchObject({
      kind: "retry",
      cause: "offline",
    });
    expect(classify(new AuthNotReadyError())).toMatchObject({
      kind: "retry",
      cause: "auth",
    });
    expect(
      classify(new NetworkError("/api/x", new TypeError("Failed to fetch"))),
    ).toMatchObject({
      kind: "retry",
      cause: "network",
    });
    for (const status of [500, 502, 503, 429]) {
      expect(classify(api(status))).toMatchObject({
        kind: "retry",
        cause: "server",
      });
    }
    expect(classify(api(401))).toEqual({ kind: "refresh" });
    for (const status of [400, 402, 403, 404, 409, 422]) {
      expect(classify(api(status))).toEqual({
        kind: "rejected",
        status,
        reason: "nope",
      });
    }
  });

  it("stops at a rejected write, keeps it with its reason, and sends nothing past it", async () => {
    const h = await harness();
    h.server.apply = () => undefined;
    h.server.failWith = (request) =>
      request.path === "/api/sets/item-2"
        ? new ApiError(400, request.path, "Reps can't be negative.")
        : null;
    for (const n of [1, 2, 3]) await h.layer.queue.enqueue(item(n));
    await h.layer.queue.settled();

    expect(paths(h)).toEqual(["/api/sets/item-1", "/api/sets/item-2"]);
    const { items } = h.layer.queue.getState();
    expect(items.map((i) => i.request.path)).toEqual([
      "/api/sets/item-2",
      "/api/sets/item-3",
    ]);
    expect(items[0]?.failure).toMatchObject({
      kind: "rejected",
      status: 400,
      reason: "Reps can't be negative.",
    });
    expect(summarize(h.layer.queue.getState(), true)).toMatchObject({
      state: "rejected",
      pending: 2,
      reason: "Reps can't be negative.",
    });
    expect(h.timers.scheduled).toEqual([]);

    // Further triggers don't push past it.
    await h.layer.queue.enqueue(item(4));
    h.connectivity.set(true);
    await h.layer.queue.settled();
    expect(paths(h)).toHaveLength(2);

    // Once the lifter acts, it is sent again, then the rest in order.
    h.server.failWith = null;
    await h.layer.queue.retryRejected();
    expect(paths(h).slice(2)).toEqual([
      "/api/sets/item-2",
      "/api/sets/item-3",
      "/api/sets/item-4",
    ]);
  });

  it("survives a reload: the backlog is still there, in order, and flushes", async () => {
    const first = await harness();
    first.connectivity.online = false;
    for (const n of [1, 2, 3]) await first.layer.queue.enqueue(item(n));
    await first.layer.queue.settled();
    first.layer.close();
    harnesses = harnesses.filter((h) => h !== first);

    const server = new FakeServer();
    server.apply = () => undefined;
    const reopened = await harness({ dbName: first.dbName, server });
    // The app-start flush ran in `start()`; online, it delivered everything.
    await reopened.layer.queue.settled();
    expect(paths(reopened)).toEqual(
      [1, 2, 3].map((n) => `/api/sets/item-${n}`),
    );
    expect(reopened.layer.queue.getState().items).toEqual([]);
  });

  it("a reload with a send on the wire (an update installing itself) keeps the write and resends it", async () => {
    const first = await harness();
    first.server.apply = () => undefined;
    first.server.holdNext = true; // the request never answers: the page goes
    await first.layer.queue.enqueue(item(1));
    await first.layer.queue.enqueue(item(2));
    await waitFor(() => expect(first.server.calls).toHaveLength(1));
    first.layer.close();
    harnesses = harnesses.filter((h) => h !== first);

    const server = new FakeServer();
    server.apply = () => undefined;
    const reopened = await harness({ dbName: first.dbName, server });
    await reopened.layer.queue.settled();
    // The write on the wire was never acknowledged, so it is sent again
    // (the server's ON CONFLICT (id) DO NOTHING makes that safe), in order.
    expect(paths(reopened)).toEqual(["/api/sets/item-1", "/api/sets/item-2"]);
    expect(reopened.layer.queue.getState().items).toEqual([]);
  });

  it("holds writes made by another account instead of sending them", async () => {
    let current: string | null = "someone_else";
    const h = await harness({ currentUserId: () => current });
    h.server.apply = () => undefined;
    await h.layer.queue.enqueue(item(1));
    await h.layer.queue.settled();
    expect(h.server.calls).toEqual([]);
    expect(summarize(h.layer.queue.getState(), true)).toMatchObject({
      state: "held",
    });

    current = USER;
    await h.layer.queue.kick();
    expect(paths(h)).toEqual(["/api/sets/item-1"]);
  });

  it("treats 408 and a 4xx without the API's JSON body as retries, not rejections", () => {
    expect(classify(new ApiError(408, "/api/x", null))).toMatchObject({
      kind: "retry",
      cause: "server",
      status: 408,
    });
    // CloudFront or the edge, not our API: no `{ ok: false, error }` body.
    for (const status of [400, 403, 404, 409]) {
      expect(classify(new ApiError(status, "/api/x", null))).toMatchObject({
        kind: "retry",
        cause: "server",
        status,
      });
    }
    expect(
      classify(new ApiError(403, "/api/x", "Your trial has ended.")),
    ).toEqual({
      kind: "rejected",
      status: 403,
      reason: "Your trial has ended.",
    });
  });
});

describe("mutation queue lanes (one per session)", () => {
  it("keeps sequence order within a lane and across ready lanes", async () => {
    const h = await harness();
    h.server.apply = () => undefined;
    h.connectivity.online = false;
    for (const input of [
      laneItem("a", 1),
      laneItem("b", 1),
      laneItem("a", 2),
      laneItem("b", 2),
    ]) {
      await h.layer.queue.enqueue(input);
    }
    h.connectivity.set(true);
    await h.layer.queue.settled();
    expect(paths(h)).toEqual([
      "/api/sets/a-1",
      "/api/sets/b-1",
      "/api/sets/a-2",
      "/api/sets/b-2",
    ]);
  });

  it("flushes account B's session while account A's is held", async () => {
    const h = await harness({ currentUserId: () => "user_b" });
    h.server.apply = () => undefined;
    await h.layer.queue.enqueue(laneItem("a", 1, USER));
    await h.layer.queue.enqueue(laneItem("b", 1, "user_b"));
    await h.layer.queue.enqueue(laneItem("a", 2, USER));
    await h.layer.queue.enqueue(laneItem("b", 2, "user_b"));
    await h.layer.queue.settled();

    expect(paths(h)).toEqual(["/api/sets/b-1", "/api/sets/b-2"]);
    const state = h.layer.queue.getState();
    expect(state.items.map((i) => i.request.path)).toEqual([
      "/api/sets/a-1",
      "/api/sets/a-2",
    ]);
    expect(state.heldLanes.get("a")).toMatch(/another account/);
    expect(summarize(state, true)).toMatchObject({
      state: "held",
      sessionId: "a",
      pending: 2,
    });
  });

  it("a rejected session stops only its own lane; a later session still syncs", async () => {
    const h = await harness();
    h.server.apply = () => undefined;
    h.server.failWith = (request) =>
      request.path === "/api/sets/a-1"
        ? new ApiError(409, request.path, "Set 1 is already logged.")
        : null;
    await h.layer.queue.enqueue(laneItem("a", 1));
    await h.layer.queue.enqueue(laneItem("a", 2));
    await h.layer.queue.enqueue(laneItem("b", 1));
    await h.layer.queue.enqueue(laneItem("b", 2));
    await h.layer.queue.settled();

    expect(paths(h)).toEqual([
      "/api/sets/a-1",
      "/api/sets/b-1",
      "/api/sets/b-2",
    ]);
    const state = h.layer.queue.getState();
    expect(state.items.map((i) => i.request.path)).toEqual([
      "/api/sets/a-1",
      "/api/sets/a-2",
    ]);
    expect(summarize(state, true)).toEqual({
      state: "rejected",
      pending: 2,
      reason: "Set 1 is already logged.",
      sessionId: "a",
    });

    h.server.failWith = null;
    await h.layer.queue.retryRejected("a");
    expect(paths(h).slice(3)).toEqual(["/api/sets/a-1", "/api/sets/a-2"]);
  });

  it("a lane backing off doesn't hold up another, and resumes in order when due", async () => {
    const h = await harness();
    h.server.apply = () => undefined;
    let outage = true;
    h.server.failWith = (request) =>
      outage && request.path.startsWith("/api/sets/a-")
        ? new ApiError(503, request.path, null)
        : null;
    h.connectivity.online = false;
    for (const input of [
      laneItem("a", 1),
      laneItem("a", 2),
      laneItem("b", 1),
    ]) {
      await h.layer.queue.enqueue(input);
    }
    h.connectivity.set(true);
    await h.layer.queue.settled();

    expect(paths(h)).toEqual(["/api/sets/a-1", "/api/sets/b-1"]);
    expect(h.layer.queue.getState().backoff.has("a")).toBe(true);
    expect(summarize(h.layer.queue.getState(), true)).toMatchObject({
      state: "retrying",
      sessionId: "a",
    });
    // Offline attempts count toward the backoff too (D7), so read the count.
    const a1 = h.layer.queue.getState().items[0]!;
    expect(a1.failure).toMatchObject({
      kind: "retry",
      cause: "server",
      status: 503,
    });
    expect(h.timers.scheduled.at(-1)).toBe(backoffMs(a1.attempts));

    outage = false;
    h.timers.fire();
    await h.layer.queue.settled();
    expect(paths(h).slice(2)).toEqual(["/api/sets/a-1", "/api/sets/a-2"]);
    expect(h.layer.queue.getState().items).toEqual([]);
  });

  it("a kick while a send is in flight isn't lost: a failed send retries at once", async () => {
    const h = await harness();
    h.server.apply = () => undefined;
    let calls = 0;
    h.server.failWith = (request) =>
      ++calls === 1 ? new ApiError(503, request.path, null) : null;
    h.server.holdNext = true; // attempt 1 stays on the wire
    await h.layer.queue.enqueue(laneItem("a", 1));
    await waitFor(() => expect(h.server.calls).toHaveLength(1));

    void h.layer.queue.kick(); // e.g. the `online` event, mid-send
    h.server.release(); // attempt 1 now fails with a 503
    await h.layer.queue.settled();

    expect(paths(h)).toEqual(["/api/sets/a-1", "/api/sets/a-1"]);
    expect(h.layer.queue.getState().items).toEqual([]);
    expect(h.timers.scheduled).toEqual([]); // no backoff was waited out
  });

  it("without a kick, the same failure waits out its backoff", async () => {
    const h = await harness();
    h.server.apply = () => undefined;
    h.server.failWith = (request) => new ApiError(503, request.path, null);
    h.server.holdNext = true;
    await h.layer.queue.enqueue(laneItem("a", 1));
    await waitFor(() => expect(h.server.calls).toHaveLength(1));
    h.server.release();
    await h.layer.queue.settled();
    expect(h.server.calls).toHaveLength(1);
    expect(h.timers.scheduled).toEqual([1000]);
  });

  it("abandons a hung send after the request timeout and retries it, unblocking other lanes", async () => {
    const h = await harness({ requestTimeoutMs: 30 });
    h.server.apply = () => undefined;
    h.server.holdNext = true; // a-1 never answers
    h.connectivity.online = false;
    await h.layer.queue.enqueue(laneItem("a", 1));
    await h.layer.queue.enqueue(laneItem("b", 1));
    h.connectivity.set(true);
    await h.layer.queue.settled();

    expect(paths(h)).toEqual(["/api/sets/a-1", "/api/sets/b-1"]);
    const [a1] = h.layer.queue.getState().items;
    expect(a1?.request.path).toBe("/api/sets/a-1");
    expect(a1?.failure).toMatchObject({
      kind: "retry",
      cause: "network",
      message: expect.stringMatching(/didn't answer/) as unknown,
    });
    expect(h.layer.queue.getState().backoff.has("a")).toBe(true);
    expect(classify(new RequestTimeoutError(20_000))).toMatchObject({
      kind: "retry",
      cause: "network",
    });
  });
});
