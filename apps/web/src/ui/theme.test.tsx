import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyTheme,
  readStoredTheme,
  resolvedTheme,
  THEME_STORAGE_KEY,
  toggleTheme,
} from "./theme.js";
import { ThemeToggle } from "./theme-toggle.js";

const pinnedChrome = () => document.getElementById("tanren-theme-color");

/** Makes the device report a dark (or light) scheme. */
function deviceScheme(scheme: "light" | "dark") {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(prefers-color-scheme: dark)" && scheme === "dark",
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  pinnedChrome()?.remove();
});

describe("theme", () => {
  it("pins the theme on <html>, remembers it, and pins the browser chrome", () => {
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(readStoredTheme()).toBe("dark");
    expect(resolvedTheme()).toBe("dark");
    expect(pinnedChrome()).toHaveAttribute("name", "theme-color");
  });

  it("ignores a stored value that is not a theme", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    expect(readStoredTheme()).toBeNull();
  });

  it("survives storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readStoredTheme()).toBeNull();
    expect(() => applyTheme("dark")).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(() => toggleTheme()).not.toThrow();
  });

  it("hands control back to the device when the toggle lands on its scheme", () => {
    deviceScheme("dark");
    toggleTheme(); // dark device -> light: an explicit choice
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(pinnedChrome()).not.toBeNull();

    toggleTheme(); // back to dark, which is the device's: no choice left
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(pinnedChrome()).toBeNull();
    expect(resolvedTheme()).toBe("dark");
  });

  it("follows the device until pressed, then flips, stores, and lets go again", async () => {
    const user = userEvent.setup();
    // jsdom has no matchMedia: the device reads as light.
    render(<ThemeToggle />);
    const toggle = screen.getByRole("button", {
      name: "Light theme, switch to dark",
    });
    expect(toggle).toHaveTextContent("Light");

    await user.click(toggle);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    const back = screen.getByRole("button", {
      name: "Dark theme, switch to light",
    });
    expect(back).toHaveTextContent("Dark");

    await user.click(back);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(screen.getByRole("button")).toHaveTextContent("Light");
  });

  it("follows a choice made in another tab, browser chrome included", () => {
    render(<ThemeToggle />);
    act(() => {
      localStorage.setItem(THEME_STORAGE_KEY, "dark");
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: THEME_STORAGE_KEY,
          newValue: "dark",
        }),
      );
    });
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(pinnedChrome()).not.toBeNull();
    expect(screen.getByRole("button")).toHaveTextContent("Dark");

    act(() => {
      localStorage.removeItem(THEME_STORAGE_KEY);
      window.dispatchEvent(
        new StorageEvent("storage", { key: THEME_STORAGE_KEY, newValue: null }),
      );
    });
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(pinnedChrome()).toBeNull();
  });
});
