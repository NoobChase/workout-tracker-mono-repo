import { describe, expect, it } from "vitest";
import { homeMode } from "./home-mode.js";

const item = {
  programId: "p",
  programName: "Push Pull Legs",
  workoutId: "w",
  workoutName: "Push A",
  cycleNumber: 1,
};

/** Nothing to train, read from the server. */
const empty = {
  next: [],
  inProgress: [],
  waiting: [],
  source: "server" as const,
  isLoading: false,
  error: null,
};

const base = {
  next: empty,
  programs: { data: { programs: [{}] }, error: null },
  online: true,
  authReady: true,
};

describe("homeMode", () => {
  it("is loading while what's next loads, or waits on sign-in", () => {
    expect(homeMode({ ...base, next: { ...empty, isLoading: true } })).toBe(
      "loading",
    );
    expect(
      homeMode({
        ...base,
        next: { ...empty, source: "none" },
        programs: { error: null },
        authReady: false,
      }),
    ).toBe("loading");
  });

  it("trains whenever there is something to start, resume or wait on", () => {
    expect(homeMode({ ...base, next: { ...empty, next: [item] } })).toBe(
      "train",
    );
    // Even offline, from the device's snapshot, with no program list.
    expect(
      homeMode({
        next: { ...empty, source: "device", next: [item] },
        programs: { error: null },
        online: false,
        authReady: false,
      }),
    ).toBe("train");
  });

  it("with nothing to train, the program list tells first run from idle", () => {
    expect(
      homeMode({ ...base, programs: { data: { programs: [] }, error: null } }),
    ).toBe("first-run");
    expect(homeMode(base)).toBe("idle");
  });

  it("without the list: a failed read is an error, no signal is offline", () => {
    const failed = new Error("down");
    expect(
      homeMode({
        ...base,
        next: { ...empty, source: "none", error: failed },
        programs: { error: null },
      }),
    ).toBe("error");
    expect(
      homeMode({
        ...base,
        next: { ...empty, source: "device" },
        programs: { error: null },
        online: false,
      }),
    ).toBe("offline");
    expect(homeMode({ ...base, programs: { error: failed } })).toBe("error");
    expect(homeMode({ ...base, programs: { error: null } })).toBe("loading");
  });
});
