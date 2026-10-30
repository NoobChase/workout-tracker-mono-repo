import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button.js";

describe("Button busy", () => {
  it("ignores presses while busy, pointer and keyboard alike, and keeps focus", async () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Skip Legs</Button>);
    const button = screen.getByRole("button", { name: "Skip Legs" });
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <Button loading onClick={onClick}>
        Skip Legs
      </Button>,
    );
    expect(button).toHaveAttribute("aria-busy", "true");
    // Not disabled: the lifter's focus (and its ring) stays where it was.
    expect(button).not.toBeDisabled();
    button.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    button.click();
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(button).toHaveFocus();
  });

  it("a busy submit button doesn't submit its form", async () => {
    const onSubmit = vi.fn((e: { preventDefault: () => void }) =>
      e.preventDefault(),
    );
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit" loading>
          Save
        </Button>
      </form>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
