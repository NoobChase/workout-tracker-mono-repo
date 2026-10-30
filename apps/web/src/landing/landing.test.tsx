import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Landing } from "./landing.js";

function renderLanding(signedIn = false) {
  const onEnter = vi.fn();
  render(<Landing onEnter={onEnter} signedIn={signedIn} />);
  return onEnter;
}

describe("Landing", () => {
  it("Log in opens sign-in; Get started, Start training and the trial open sign-up", async () => {
    const onAuth = renderLanding();
    const user = userEvent.setup();

    const logIn = screen.getByRole("link", { name: "Log in" });
    expect(logIn).toHaveAttribute("href", "/sign-in");
    await user.click(logIn);
    expect(onAuth).toHaveBeenLastCalledWith("/sign-in");

    const signUps = [
      ...screen.getAllByRole("link", { name: "Get started" }),
      ...screen.getAllByRole("link", { name: "Start training" }),
    ];
    // Header and trial card; hero and closing.
    expect(signUps).toHaveLength(4);
    for (const link of signUps) {
      expect(link).toHaveAttribute("href", "/sign-up");
      await user.click(link);
      expect(onAuth).toHaveBeenLastCalledWith("/sign-up");
    }
    expect(onAuth).toHaveBeenCalledTimes(5);
  });

  it("signed in, every call to action is Open app, home, and Log in is gone", async () => {
    const onEnter = renderLanding(true);
    const user = userEvent.setup();

    expect(screen.queryByRole("link", { name: "Log in" })).toBeNull();
    expect(
      screen.queryByRole("link", { name: /Get started|Start training/ }),
    ).toBeNull();
    const open = screen.getAllByRole("link", { name: "Open app" });
    // Header, hero, trial card and closing.
    expect(open).toHaveLength(4);
    expect(
      within(screen.getByRole("banner")).getByRole("link", {
        name: "Open app",
      }),
    ).toBeVisible();
    for (const link of open) {
      expect(link).toHaveAttribute("href", "/");
      await user.click(link);
      expect(onEnter).toHaveBeenLastCalledWith("/");
    }
    expect(onEnter).toHaveBeenCalledTimes(4);
  });

  it("How it works leads to the three things", () => {
    renderLanding();
    expect(screen.getByRole("link", { name: "How it works" })).toHaveAttribute(
      "href",
      "#usage",
    );
    expect(screen.getByRole("region", { name: "In practice" })).toHaveAttribute(
      "id",
      "usage",
    );
  });

  it("labels everything not built yet as coming soon", () => {
    renderLanding();
    const soon = (name: string) =>
      within(screen.getByRole("region", { name })).getAllByText("Coming soon");
    expect(soon("See also: your AI")).toHaveLength(1);
    expect(soon("Pricing")).toHaveLength(1);
    // Exercise swap and analytics, inside "Three things".
    const harden = screen.getByRole("heading", { name: /See it harden/ });
    expect(within(harden).getByText("Coming soon")).toBeInTheDocument();
    expect(
      screen.getByText(/Swap an exercise and the plan stays the plan/),
    ).toHaveTextContent("Coming soon");
  });

  it("shows no price, no Subscribe, and no invented numbers", () => {
    renderLanding();
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/\$/);
    expect(screen.queryByText(/subscribe/i)).toBeNull();
    expect(screen.getByText("Price not set yet")).toBeInTheDocument();
    expect(screen.getByText("demo data")).toBeInTheDocument();
  });

  it("credits KanjiVG under CC BY-SA 3.0, and drops the mockup's name", () => {
    renderLanding();
    const footer = screen.getByRole("contentinfo");
    expect(
      within(footer).getByRole("link", { name: "KanjiVG" }),
    ).toHaveAttribute("href", "https://kanjivg.tagaini.net/");
    expect(
      within(footer).getByRole("link", { name: "CC BY-SA 3.0" }),
    ).toHaveAttribute(
      "href",
      "https://creativecommons.org/licenses/by-sa/3.0/",
    );
    expect(footer).toHaveTextContent("Tanren · US only");
    expect(footer).not.toHaveTextContent(/Mockup|Stroke Order/);
  });

  it("keeps the kanji to the hero and the closing lockup, not the header", () => {
    renderLanding();
    expect(screen.getByRole("banner")).not.toHaveTextContent(/[鍛錬]/);
    expect(
      within(screen.getByRole("region", { name: "Start" })).getByText("鍛錬"),
    ).toBeInTheDocument();
  });

  it("with no motion, the characters are written already and there is nothing to replay", () => {
    // jsdom has no matchMedia or Web Animations: the still path.
    renderLanding();
    const entry = document.querySelector("[data-intro]");
    expect(entry).toHaveAttribute("data-intro", "done");
    expect(screen.queryByRole("button", { name: /Replay|Skip/ })).toBeNull();
    expect(
      screen.getByText(/is written in 33 strokes: 17 for 鍛, 16 for 錬/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "鍛, tan: to forge" }),
    ).toHaveAccessibleDescription("鍛tan — to forge, to temper");
  });
});
