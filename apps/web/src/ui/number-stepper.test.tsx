import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { NumberStepper, type NumberStepperProps } from "./number-stepper.js";

type Harness = Partial<NumberStepperProps> & {
  initial: number;
  spy?: (n: number) => void;
};

/** A controlled stepper; `setFromOutside` changes its value as a parent would. */
let setFromOutside: (n: number) => void = () => {};

function Controlled({ initial, spy, ...rest }: Harness) {
  const [value, setValue] = useState(initial);
  setFromOutside = setValue;
  return (
    <NumberStepper
      label="Weight"
      unit="lb"
      step={5}
      decimal
      max={1000}
      {...rest}
      value={value}
      onValueChange={(n) => {
        spy?.(n);
        setValue(n);
      }}
    />
  );
}

const reps = {
  label: "Reps",
  unit: "reps",
  step: 1,
  decimal: false,
  max: 100,
} as const;

describe("NumberStepper", () => {
  it("steps with the − and + buttons, named for what they do", async () => {
    const user = userEvent.setup();
    render(<Controlled initial={225} />);
    const field = screen.getByRole("spinbutton", { name: "Weight" });

    await user.click(
      screen.getByRole("button", { name: "Increase weight by 5 lb" }),
    );
    expect(field).toHaveValue("230");
    expect(field).toHaveAttribute("aria-valuetext", "230 lb");

    await user.click(
      screen.getByRole("button", { name: "Decrease weight by 5 lb" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Decrease weight by 5 lb" }),
    );
    expect(field).toHaveValue("220");
  });

  it("names a count without repeating it: “Decrease reps by 1”", () => {
    render(<Controlled initial={5} {...reps} />);
    expect(
      screen.getByRole("button", { name: "Decrease reps by 1" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Increase reps by 1" }),
    ).toBeInTheDocument();
  });

  it("names a fractional step with its unit: “Increase weight by 2.5 kg”", () => {
    render(<Controlled initial={100} unit="kg" step={2.5} />);
    expect(
      screen.getByRole("button", { name: "Increase weight by 2.5 kg" }),
    ).toBeInTheDocument();
  });

  it("disables decrease at the minimum and never goes below it", async () => {
    const user = userEvent.setup();
    render(<Controlled initial={5} {...reps} min={4} />);
    const decrease = screen.getByRole("button", { name: "Decrease reps by 1" });
    await user.click(decrease);
    expect(screen.getByRole("spinbutton")).toHaveValue("4");
    expect(decrease).toBeDisabled();
  });

  it("disables increase at the maximum", () => {
    render(<Controlled initial={100} {...reps} />);
    expect(
      screen.getByRole("button", { name: "Increase reps by 1" }),
    ).toBeDisabled();
  });

  it("moves one step on ↑/↓ and five on PageUp/PageDown", async () => {
    const user = userEvent.setup();
    render(<Controlled initial={225} />);
    const field = screen.getByRole("spinbutton");
    await user.click(field);
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(field).toHaveValue("235");
    await user.keyboard("{ArrowDown}");
    expect(field).toHaveValue("230");
    await user.keyboard("{PageUp}");
    expect(field).toHaveValue("255");
    await user.keyboard("{PageDown}{PageDown}");
    expect(field).toHaveValue("205");
  });

  it("steps from what is typed when ↑ or PageUp follow typing", async () => {
    const user = userEvent.setup();
    render(<Controlled initial={225} />);
    const field = screen.getByRole("spinbutton");
    await user.click(field);
    await user.keyboard("300{ArrowUp}");
    expect(field).toHaveValue("305");
    await user.keyboard("{PageUp}");
    expect(field).toHaveValue("330");
    await user.tab();
    expect(field).toHaveValue("330");
  });

  it("takes a typed value, reporting it as it is typed", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Controlled initial={225} spy={spy} />);
    const field = screen.getByRole("spinbutton");
    await user.click(field); // focus selects the whole number
    await user.keyboard("227.5");
    expect(spy).toHaveBeenLastCalledWith(227.5);
    await user.tab();
    expect(field).toHaveValue("227.5");
  });

  it("never reports an out-of-range entry, and announces what it shows", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Controlled initial={5} {...reps} spy={spy} />);
    const field = screen.getByRole("spinbutton");
    await user.click(field);
    await user.keyboard("150");

    expect(field).toHaveValue("150");
    expect(spy).not.toHaveBeenCalledWith(150);
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAttribute("aria-valuenow", "150");
    expect(field).toHaveAttribute("aria-valuetext", "150 reps");

    await user.tab(); // leaving clamps
    expect(field).toHaveValue("100");
    expect(spy).toHaveBeenLastCalledWith(100);
    expect(field).not.toHaveAttribute("aria-invalid");
    expect(field).toHaveAttribute("aria-valuenow", "100");
  });

  it("clamps an entry below the minimum when the field is left", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Controlled initial={8} {...reps} min={4} spy={spy} />);
    const field = screen.getByRole("spinbutton");
    await user.click(field);
    await user.keyboard("2");
    expect(spy).not.toHaveBeenCalled();
    expect(field).toHaveAttribute("aria-invalid", "true");
    await user.tab();
    expect(field).toHaveValue("4");
    expect(spy).toHaveBeenLastCalledWith(4);
  });

  it("ignores letters, reverts an empty entry and clamps on leaving", async () => {
    const user = userEvent.setup();
    render(<Controlled initial={225} />);
    const field = screen.getByRole("spinbutton");

    await user.click(field);
    await user.keyboard("abc");
    expect(field).toHaveValue("225");

    await user.clear(field);
    expect(field).toHaveValue("");
    await user.tab();
    expect(field).toHaveValue("225");

    await user.click(field);
    await user.keyboard("5000");
    await user.tab();
    expect(field).toHaveValue("1000");
  });

  it("refuses a decimal point in a whole-number stepper", async () => {
    const user = userEvent.setup();
    render(<Controlled initial={5} {...reps} />);
    const field = screen.getByRole("spinbutton");
    await user.click(field);
    await user.keyboard("8.");
    expect(field).toHaveValue("8");
  });

  it("shows a value changed from outside even while focused", async () => {
    const user = userEvent.setup();
    render(<Controlled initial={225} />);
    const field = screen.getByRole("spinbutton");
    await user.click(field);
    expect(field).toHaveFocus();
    act(() => setFromOutside(245));
    expect(field).toHaveValue("245");
    expect(field).toHaveAttribute("aria-valuenow", "245");
  });
});

describe("NumberStepper, empty", () => {
  function Empty({ spy }: { spy: (n: number) => void }) {
    const [value, setValue] = useState<number | null>(null);
    return (
      <NumberStepper
        label="Weight"
        unit="lb"
        step={5}
        decimal
        max={1000}
        value={value}
        invalid={value === null}
        onValueChange={(n) => {
          spy(n);
          setValue(n);
        }}
      />
    );
  }

  it("starts blank and says so; − waits, + starts from the first step", async () => {
    const spy = vi.fn();
    render(<Empty spy={spy} />);
    const field = screen.getByRole("spinbutton", { name: "Weight" });
    expect(field).toHaveValue("");
    expect(field).toHaveAttribute("aria-valuetext", "Empty");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByRole("button", { name: "Decrease weight by 5 lb" }),
    ).toBeDisabled();

    await userEvent.click(
      screen.getByRole("button", { name: "Increase weight by 5 lb" }),
    );
    expect(spy).toHaveBeenLastCalledWith(5);
    expect(field).toHaveValue("5");
    expect(field).not.toHaveAttribute("aria-invalid");
  });

  it("takes a typed number from blank", async () => {
    const spy = vi.fn();
    render(<Empty spy={spy} />);
    await userEvent.type(
      screen.getByRole("spinbutton", { name: "Weight" }),
      "135",
    );
    expect(spy).toHaveBeenLastCalledWith(135);
  });
});
