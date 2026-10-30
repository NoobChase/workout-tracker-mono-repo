import { describe, expect, it, vi } from "vitest";
import type { LocalSession } from "../local/sessions.js";
import { appUpdateContext, isSafeMove } from "./update-prompt.js";

const registerSW = vi.hoisted(() =>
  vi.fn((_options: unknown) => vi.fn(() => Promise.resolve())),
);
vi.mock("virtual:pwa-register", () => ({ registerSW }));

const USER = {
  userId: "user_1",
  email: null,
  recordedAt: "2026-10-30T10:00:00Z",
};

function sessions(
  ...statuses: LocalSession["status"][]
): ReadonlyMap<string, LocalSession> {
  return new Map(
    statuses.map((status, i) => [
      `s${i}`,
      { sessionId: `s${i}`, status } as LocalSession,
    ]),
  );
}

describe("appUpdateContext", () => {
  const base = {
    pathname: "/",
    lastUser: USER,
    isSignedIn: true,
    sessions: sessions(),
  };

  it("Clerk's pages and /about are public, signed in or not", () => {
    for (const pathname of [
      "/sign-in",
      "/sign-in/factor-one",
      "/sign-up",
      "/about",
    ]) {
      expect(
        appUpdateContext({
          ...base,
          pathname,
          sessions: sessions("IN_PROGRESS"),
        }),
      ).toEqual({ page: "public" });
    }
  });

  it("nobody signed in is public; not yet known is null", () => {
    expect(
      appUpdateContext({ ...base, lastUser: null, isSignedIn: false }),
    ).toEqual({ page: "public" });
    expect(appUpdateContext({ ...base, lastUser: undefined })).toBeNull();
  });

  it("signed in, says whether a workout is in progress on this device", () => {
    expect(appUpdateContext(base)).toEqual({
      page: "app",
      workoutInProgress: false,
    });
    expect(
      appUpdateContext({ ...base, sessions: sessions("FINISHED", "SKIPPED") }),
    ).toEqual({ page: "app", workoutInProgress: false });
    expect(
      appUpdateContext({
        ...base,
        pathname: "/programs",
        sessions: sessions("FINISHED", "IN_PROGRESS"),
      }),
    ).toEqual({ page: "app", workoutInProgress: true });
    // Clerk's session alone, the record not written yet.
    expect(appUpdateContext({ ...base, lastUser: null })).toEqual({
      page: "app",
      workoutInProgress: false,
    });
  });
});

describe("isSafeMove", () => {
  it("a change of screen is; a step inside Clerk's flow or no change isn't", () => {
    expect(isSafeMove("/", "/programs")).toBe(true);
    expect(isSafeMove("/programs/1/cycles/2", "/programs/1")).toBe(true);
    expect(isSafeMove("/sign-in", "/")).toBe(true);
    expect(isSafeMove("/sign-in", "/sign-in/factor-one")).toBe(false);
    expect(isSafeMove("/sign-up", "/sign-in")).toBe(false);
    expect(isSafeMove("/history", "/history")).toBe(false);
  });
});

describe("the page's registration (virtual:pwa-register, mocked)", () => {
  it("registers once, and Reload asks the waiting worker to take over", async () => {
    const { updates } = await import("../boot/updates.js");
    updates.start();
    updates.start();
    await vi.waitFor(() => expect(registerSW).toHaveBeenCalledOnce());
    const options = registerSW.mock.calls[0]![0] as {
      onNeedRefresh: () => void;
    };
    const skipWaiting = registerSW.mock.results[0]!.value as ReturnType<
      typeof vi.fn
    >;

    updates.setContext({ page: "app", workoutInProgress: true });
    options.onNeedRefresh();
    expect(updates.getPrompt()).toBe("waiting");
    updates.applyNow();
    await vi.waitFor(() => expect(skipWaiting).toHaveBeenCalledWith(true));
  });
});
