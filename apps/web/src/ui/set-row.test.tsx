import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SetLog, SetRow, type SetStatus } from "./set-row.js";

function renderRow(status: SetStatus, kind?: "warmup" | "drop") {
  return render(
    <SetLog>
      <SetRow
        index={3}
        weight={225}
        reps={5}
        unit="lb"
        status={status}
        kind={kind}
      />
    </SetLog>,
  );
}

describe("SetRow", () => {
  it.each([
    ["logged", "logged"],
    ["queued", "queued, no signal"],
    ["failed", "failed, retrying"],
    ["live", "now"],
    ["planned", "planned"],
  ] as const)("says %s as “%s”", (status, text) => {
    renderRow(status);
    const row = screen.getByRole("listitem");
    expect(row).toHaveAttribute("data-status", status);
    expect(row).toHaveTextContent(text);
    expect(row).toHaveTextContent(/Set 3/);
  });

  it("marks only the live set as the current step", () => {
    renderRow("live");
    expect(screen.getByRole("listitem")).toHaveAttribute(
      "aria-current",
      "step",
    );
  });

  it("labels sets that don't count", () => {
    renderRow("logged", "warmup");
    expect(screen.getByRole("listitem")).toHaveTextContent("Warmup");
  });

  it("rules a set into the log when it moves from live to logged", () => {
    const { rerender } = renderRow("live");
    rerender(
      <SetLog>
        <SetRow index={3} weight={225} reps={5} unit="lb" status="logged" />
      </SetLog>,
    );
    const row = screen.getByRole("listitem");
    expect(row).toHaveAttribute("data-status", "logged");
    expect(row).not.toHaveAttribute("aria-current");
  });
});
