import { useCallback, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

/**
 * Where the toggle remembers an explicit choice. The pre-paint script in
 * index.html reads the same key, so the two must not drift.
 */
export const THEME_STORAGE_KEY = "tanren-theme";

/**
 * The theme-color tag that pins the browser chrome while a theme is pinned.
 * It goes first in <head>, so it wins over index.html's two per-scheme tags;
 * removing it hands the chrome back to them. Same id as the pre-paint script.
 */
const PINNED_CHROME_ID = "tanren-theme-color";

const CHANGE_EVENT = "tanren-theme-change";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

/** The stored choice, or null when there is none or storage is unavailable. */
export function readStoredTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

/** The device's scheme. */
export function systemTheme(): Theme {
  if (typeof matchMedia !== "function") return "light";
  return matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

/** The theme actually showing: an explicit choice, else the device's. */
export function resolvedTheme(): Theme {
  const explicit = document.documentElement.dataset.theme;
  return isTheme(explicit) ? explicit : systemTheme();
}

/**
 * Points the browser chrome at the page's own --bg. Read from the computed
 * style rather than kept as a second copy of the hex values.
 */
function syncChrome() {
  const existing = document.getElementById(PINNED_CHROME_ID);
  if (!isTheme(document.documentElement.dataset.theme)) {
    existing?.remove();
    return;
  }
  let meta: HTMLMetaElement;
  if (existing instanceof HTMLMetaElement) {
    meta = existing;
  } else {
    existing?.remove();
    meta = document.createElement("meta");
    meta.id = PINNED_CHROME_ID;
    meta.name = "theme-color";
    document.head.prepend(meta);
  }
  const bg = getComputedStyle(document.documentElement).backgroundColor;
  if (bg) meta.content = bg;
}

function store(theme: Theme | null) {
  try {
    if (theme) localStorage.setItem(THEME_STORAGE_KEY, theme);
    else localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {
    // Private mode or storage disabled: the choice lasts for this page only.
  }
}

/** Pins the theme on <html> and remembers it. Storage failure is not fatal. */
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  store(theme);
  syncChrome();
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Forgets any choice: the device decides again, now and on later visits. */
export function followDevice() {
  delete document.documentElement.dataset.theme;
  store(null);
  syncChrome();
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * Flips the showing theme. Landing on the device's own scheme is the same as
 * having no preference, so it clears the stored choice and the device is back
 * in control (a later OS switch is followed again).
 */
export function toggleTheme() {
  const next: Theme = resolvedTheme() === "dark" ? "light" : "dark";
  if (next === systemTheme()) followDevice();
  else applyTheme(next);
}

function subscribe(onChange: () => void) {
  const media =
    typeof matchMedia === "function" ? matchMedia(DARK_QUERY) : null;
  // Another tab changed the choice: follow it here too, chrome included.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
    const stored = readStoredTheme();
    if (stored) document.documentElement.dataset.theme = stored;
    else delete document.documentElement.dataset.theme;
    syncChrome();
    onChange();
  };
  media?.addEventListener("change", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    media?.removeEventListener("change", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** The showing theme, kept current with the device and the toggle. */
export function useTheme() {
  const theme = useSyncExternalStore(
    subscribe,
    resolvedTheme,
    (): Theme => "light",
  );
  const toggle = useCallback(toggleTheme, []);
  return { theme, setTheme: applyTheme, followDevice, toggle } as const;
}
