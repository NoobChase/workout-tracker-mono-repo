import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FRAMES, OfflineDemo, STILL_FRAME } from "./offline-demo.js";

function demoCard() {
  return document.querySelector<HTMLElement>("[data-frame]")!;
}

function statuses() {
  return [...demoCard().querySelectorAll("[data-slot=set-row]")].map((row) =>
    row.getAttribute("data-status"),
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("OfflineDemo", () => {
  it("loops: logs online, queues with no signal, syncs in order, starts over", () => {
    vi.useFakeTimers();
    render(<OfflineDemo />);
    const sync = () =>
      within(demoCard()).getByRole("status", { hidden: true }).textContent;

    expect(statuses()).toEqual(["logged", "live", "planned", "planned"]);
    expect(sync()).toBe("All sets synced");

    const seen: string[] = [];
    for (const frame of FRAMES) {
      act(() => {
        vi.advanceTimersByTime(frame.ms);
      });
      seen.push(sync() ?? "");
    }
    expect(seen).toEqual([
      "All sets synced",
      "No signal, sets will queue",
      "1 set queued, no signal",
      "2 sets queued, no signal",
      "Syncing 2 sets",
      "Syncing 1 set",
      "All sets synced",
      // Back to the start.
      "All sets synced",
    ]);
    expect(statuses()).toEqual(["logged", "live", "planned", "planned"]);
  });

  it("is one sentence to a screen reader, not a live region", () => {
    render(<OfflineDemo />);
    expect(demoCard()).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("status")).toBeNull();
    expect(
      screen.getByText(/they sync, in the order they were logged/),
    ).toBeInTheDocument();
  });

  it("pauses and plays on request", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<OfflineDemo />);
    await user.click(screen.getByRole("button", { name: "Pause demo" }));
    const frame = demoCard().dataset.frame;
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(demoCard().dataset.frame).toBe(frame);

    await user.click(screen.getByRole("button", { name: "Play demo" }));
    act(() => {
      vi.advanceTimersByTime(FRAMES[0]!.ms);
    });
    expect(demoCard().dataset.frame).not.toBe(frame);
  });

  it("holds still while offscreen", () => {
    vi.useFakeTimers();
    let report: (visible: boolean) => void = () => {};
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(
          callback: (entries: { isIntersecting: boolean }[]) => void,
        ) {
          report = (visible) => callback([{ isIntersecting: visible }]);
        }
        observe() {}
        disconnect() {}
      },
    );
    render(<OfflineDemo />);
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(demoCard().dataset.frame).toBe("0");

    act(() => {
      report(true);
    });
    act(() => {
      vi.advanceTimersByTime(FRAMES[0]!.ms);
    });
    expect(demoCard().dataset.frame).toBe("1");
  });

  it("under reduced motion is one still frame, waiting behind synced, with no control", () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      addEventListener() {},
      removeEventListener() {},
    }));
    render(<OfflineDemo />);
    expect(demoCard().dataset.frame).toBe(String(STILL_FRAME));
    expect(statuses()).toEqual(["logged", "logged", "logged", "queued"]);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(demoCard().dataset.frame).toBe(String(STILL_FRAME));
    expect(screen.queryByRole("button")).toBeNull();
  });
});
