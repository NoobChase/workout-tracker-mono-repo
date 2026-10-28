import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
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

  it("says rejected in words, with the server's reason on the line", () => {
    render(
      <SetLog>
        <SetRow
          index={3}
          weight={999}
          reps={5}
          unit="lb"
          status="rejected"
          reason="That weight is more than the bar can hold."
        />
      </SetLog>,
    );
    const row = screen.getByRole("listitem");
    expect(row).toHaveAttribute("data-status", "rejected");
    expect(row).toHaveTextContent("rejected");
    expect(row).toHaveTextContent("That weight is more than the bar can hold.");
  });

  it("is one button to edit when pressable, and reads as the set", async () => {
    const onPress = vi.fn();
    render(
      <SetLog>
        <SetRow
          index={2}
          weight={225}
          reps={5}
          unit="lb"
          status="logged"
          onPress={onPress}
        />
      </SetLog>,
    );
    const button = screen.getByRole("button", {
      name: "Set 2, 225 lb for 5 reps, logged. Edit",
    });
    await userEvent.click(button);
    expect(onPress).toHaveBeenCalledOnce();
  });

  it("an empty weight is a blank to fill, said in words", () => {
    render(
      <SetLog>
        <SetRow index={1} weight={null} reps={8} unit="kg" status="live" />
      </SetLog>,
    );
    const row = screen.getByRole("listitem");
    expect(row).toHaveTextContent("no weight yet");
    expect(row).not.toHaveTextContent("–");
  });
});
