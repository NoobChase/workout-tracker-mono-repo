import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { NumberField } from "./number-field.js";

function Weight({ start }: { start: number | null }) {
  const [value, setValue] = useState(start);
  return (
    <NumberField
      aria-label="Every set: weight in lb"
      value={value}
      onValueChange={setValue}
      min={0}
      max={2000}
      step={5}
      unit="lb"
    />
  );
}

describe("NumberField", () => {
  it("is a spinbutton with its value, range and unit", () => {
    render(<Weight start={225} />);
    const field = screen.getByRole("spinbutton", {
      name: "Every set: weight in lb",
    });
    expect(field).toHaveAttribute("aria-valuenow", "225");
    expect(field).toHaveAttribute("aria-valuemin", "0");
    expect(field).toHaveAttribute("aria-valuemax", "2000");
    expect(field).toHaveAttribute("aria-valuetext", "225 lb");
  });

  it("follows typing and the arrow keys; empty reads as not set", async () => {
    render(<Weight start={null} />);
    const field = screen.getByRole("spinbutton");
    expect(field).not.toHaveAttribute("aria-valuenow");
    expect(field).toHaveAttribute("aria-valuetext", "Not set");

    await userEvent.type(field, "100");
    expect(field).toHaveAttribute("aria-valuenow", "100");
    await userEvent.keyboard("{ArrowUp}");
    expect(field).toHaveAttribute("aria-valuenow", "105");
    expect(field).toHaveAttribute("aria-valuetext", "105 lb");
  });
});
