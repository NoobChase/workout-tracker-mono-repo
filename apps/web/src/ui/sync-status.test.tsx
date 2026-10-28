import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SyncStatus, syncStatusText } from "./sync-status.js";

describe("SyncStatus", () => {
  it.each([
    ["synced", 0, false, "All sets synced"],
    ["syncing", 2, false, "Syncing 2 sets"],
    ["syncing", 0, true, "Syncing workout"],
    ["offline", 3, true, "3 sets queued, no signal"],
    ["offline", 1, false, "1 set queued, no signal"],
    ["offline", 0, true, "Workout queued, no signal"],
    ["offline", 0, false, "No signal, sets will queue"],
    ["retrying", 1, false, "1 set failed, retrying"],
    ["retrying", 0, true, "Workout failed, retrying"],
    ["rejected", 1, false, "A set was rejected, its workout stopped syncing"],
    ["rejected", 0, true, "A workout was rejected and stopped syncing"],
    ["held", 2, false, "Sync on hold"],
  ] as const)("%s, %i sets, workout %s: “%s”", (state, sets, workout, text) => {
    expect(syncStatusText(state, sets, workout)).toBe(text);
  });

  it("is a live region, danger only when something failed", () => {
    const { rerender } = render(<SyncStatus state="rejected" pending={1} />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("data-state", "rejected");
    expect(status.className).toContain("text-danger");
    rerender(<SyncStatus state="held" />);
    expect(screen.getByRole("status").className).toContain(
      "text-muted-foreground",
    );
  });
});
