import type { RegisterSWOptions } from "virtual:pwa-register";
import { describe, expect, it, vi } from "vitest";
import {
  pageIsBusy,
  UPDATE_CHECK_INTERVAL_MS,
  updatePolicy,
  Updates,
  type UpdateContext,
} from "./updates.js";

describe("updatePolicy", () => {
  it("a public page takes a new version now", () => {
    expect(updatePolicy({ page: "public" })).toBe("now");
  });

  it("the app with no workout in progress waits for a safe moment", () => {
    expect(updatePolicy({ page: "app", workoutInProgress: false })).toBe(
      "at-safe-moment",
    );
  });

  it("a workout in progress on this device is asked, never reloaded", () => {
    expect(updatePolicy({ page: "app", workoutInProgress: true })).toBe(
      "prompt",
    );
  });
});

/** A controller over a fake `registerSW` and a fake document. */
function setup({ busy = false } = {}) {
  let options: RegisterSWOptions = {};
  const skipWaiting = vi.fn(() => {
    // The waiting worker takes control; the plugin then calls onNeedReload.
    options.onNeedReload?.();
    return Promise.resolve();
  });
  const reload = vi.fn();
  const update = vi.fn(() => Promise.resolve());
  const listeners: (() => void)[] = [];
  const visibility = {
    visibilityState: "visible" as DocumentVisibilityState,
    addEventListener: (_type: string, listener: () => void) =>
      listeners.push(listener),
  };
  let now = 1_000_000;
  const state = { busy };
  const updates = new Updates({
    register: (given) => {
      options = given;
      return skipWaiting;
    },
    reload,
    isBusy: () => state.busy,
    visibility: visibility as unknown as Document,
    now: () => now,
  });
  updates.start();
  options.onRegisteredSW?.("/sw.js", {
    update,
  } as unknown as ServiceWorkerRegistration);
  return {
    updates,
    skipWaiting,
    reload,
    update,
    state,
    /** A new version installed and waiting (the plugin's onNeedRefresh). */
    waiting: () => options.onNeedRefresh?.(),
    /** Another tab activated the new worker under this page. */
    elsewhere: () => options.onNeedReload?.(),
    visibilityChange: (to: DocumentVisibilityState) => {
      visibility.visibilityState = to;
      for (const listener of listeners) listener();
    },
    advance: (ms: number) => (now += ms),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const app = (workoutInProgress: boolean): UpdateContext => ({
  page: "app",
  workoutInProgress,
});

describe("Updates", () => {
  it("registers the service worker once", () => {
    const register = vi.fn(() => () => Promise.resolve());
    const updates = new Updates({
      register,
      reload: vi.fn(),
      isBusy: () => false,
    });
    updates.start();
    updates.start();
    expect(register).toHaveBeenCalledOnce();
  });

  it("on a public page, skips waiting and reloads at once, with no prompt", async () => {
    const t = setup();
    t.updates.setContext({ page: "public" });
    t.waiting();
    await flush();
    expect(t.skipWaiting).toHaveBeenCalledOnce();
    expect(t.reload).toHaveBeenCalledOnce();
    expect(t.updates.getPrompt()).toBeNull();
  });

  it("a version found before the page knows where it is waits for it", async () => {
    const t = setup();
    t.waiting();
    await flush();
    expect(t.skipWaiting).not.toHaveBeenCalled();
    t.updates.setContext({ page: "public" });
    await flush();
    expect(t.reload).toHaveBeenCalledOnce();
  });

  it("in the app with no workout, waits for a route change, then reloads", async () => {
    const t = setup();
    t.updates.setContext(app(false));
    t.waiting();
    await flush();
    expect(t.skipWaiting).not.toHaveBeenCalled();
    expect(t.updates.getPrompt()).toBeNull();

    t.updates.safeMoment();
    await flush();
    expect(t.skipWaiting).toHaveBeenCalledOnce();
    expect(t.reload).toHaveBeenCalledOnce();
  });

  it("in the app with no workout, the page going hidden is a safe moment", async () => {
    const t = setup();
    t.updates.setContext(app(false));
    t.waiting();
    t.visibilityChange("hidden");
    await flush();
    expect(t.reload).toHaveBeenCalledOnce();
  });

  it("never reloads while a dialog is open or someone is typing; the next moment does", async () => {
    const t = setup({ busy: true });
    t.updates.setContext(app(false));
    t.waiting();
    t.updates.safeMoment();
    await flush();
    expect(t.skipWaiting).not.toHaveBeenCalled();

    t.state.busy = false;
    t.updates.safeMoment();
    await flush();
    expect(t.reload).toHaveBeenCalledOnce();
  });

  it("a public page where someone is typing waits for a safe moment too", async () => {
    const t = setup({ busy: true });
    t.updates.setContext({ page: "public" });
    t.waiting();
    await flush();
    expect(t.skipWaiting).not.toHaveBeenCalled();
    t.state.busy = false;
    t.visibilityChange("hidden");
    await flush();
    expect(t.reload).toHaveBeenCalledOnce();
  });

  it("a busy check added by the app (a write on the wire) holds the reload", async () => {
    const t = setup();
    let mutating = true;
    t.updates.addBusyCheck(() => mutating);
    t.updates.setContext(app(false));
    t.waiting();
    t.updates.safeMoment();
    await flush();
    expect(t.skipWaiting).not.toHaveBeenCalled();
    mutating = false;
    t.updates.safeMoment();
    await flush();
    expect(t.reload).toHaveBeenCalledOnce();
  });

  it("with a workout in progress, prompts and never reloads on its own", async () => {
    const t = setup();
    t.updates.setContext(app(true));
    t.waiting();
    expect(t.updates.getPrompt()).toBe("waiting");
    t.updates.safeMoment();
    t.visibilityChange("hidden");
    await flush();
    expect(t.skipWaiting).not.toHaveBeenCalled();
    expect(t.reload).not.toHaveBeenCalled();

    // Reload, from the prompt.
    t.updates.applyNow();
    await flush();
    expect(t.skipWaiting).toHaveBeenCalledOnce();
    expect(t.reload).toHaveBeenCalledOnce();
  });

  it("Later hides the prompt; finishing the workout lets the next moment install it", async () => {
    const t = setup();
    t.updates.setContext(app(true));
    t.waiting();
    t.updates.dismiss();
    expect(t.updates.getPrompt()).toBeNull();
    t.updates.setContext(app(true));
    expect(t.updates.getPrompt()).toBeNull();

    t.updates.setContext(app(false));
    t.updates.safeMoment();
    await flush();
    expect(t.reload).toHaveBeenCalledOnce();
  });

  it("the prompt goes away by itself once no workout is in progress", () => {
    const t = setup();
    t.updates.setContext(app(true));
    t.waiting();
    expect(t.updates.getPrompt()).toBe("waiting");
    t.updates.setContext(app(false));
    expect(t.updates.getPrompt()).toBeNull();
    // A dismissal the toast reports after that is nobody's answer.
    t.updates.dismiss();
    t.updates.setContext(app(true));
    expect(t.updates.getPrompt()).toBe("waiting");
  });

  it("a version another tab activated reloads at a safe moment, or says so mid-workout", async () => {
    const inWorkout = setup();
    inWorkout.updates.setContext(app(true));
    inWorkout.elsewhere();
    expect(inWorkout.updates.getPrompt()).toBe("elsewhere");
    expect(inWorkout.reload).not.toHaveBeenCalled();

    const idle = setup();
    idle.updates.setContext(app(false));
    idle.updates.replacedElsewhere(); // another tab's storage upgrade
    idle.updates.safeMoment();
    await flush();
    expect(idle.skipWaiting).not.toHaveBeenCalled();
    expect(idle.reload).toHaveBeenCalledOnce();
  });

  it("writes pending drafts and waits for held writes before reloading", async () => {
    const t = setup();
    const order: string[] = [];
    let land: () => void = () => {};
    t.updates.beforeUpdate(() => {
      order.push("flush");
      t.updates.hold(
        new Promise<void>((resolve) => (land = resolve)).then(() => {
          order.push("draft written");
        }),
      );
    });
    t.reload.mockImplementation(() => order.push("reload"));
    t.updates.setContext({ page: "public" });
    t.waiting();
    await flush();
    expect(order).toEqual(["flush"]);
    expect(t.skipWaiting).not.toHaveBeenCalled();

    land();
    await flush();
    await flush();
    expect(order).toEqual(["flush", "draft written", "reload"]);
  });

  it("a failed draft write doesn't keep the update waiting forever", async () => {
    const t = setup();
    t.updates.hold(Promise.reject(new Error("quota")));
    t.updates.setContext({ page: "public" });
    t.waiting();
    await flush();
    await flush();
    expect(t.reload).toHaveBeenCalledOnce();
  });

  it("a page left open asks for a new version when it comes back, at most every 10 minutes", () => {
    const t = setup();
    t.visibilityChange("visible");
    expect(t.update).not.toHaveBeenCalled();
    t.advance(UPDATE_CHECK_INTERVAL_MS);
    t.visibilityChange("hidden");
    expect(t.update).not.toHaveBeenCalled();
    t.visibilityChange("visible");
    expect(t.update).toHaveBeenCalledOnce();
    t.visibilityChange("visible");
    expect(t.update).toHaveBeenCalledOnce();
  });
});

describe("pageIsBusy", () => {
  it("is busy with a dialog open or a text field focused, not otherwise", () => {
    document.body.innerHTML = `
      <button id="b">Go</button>
      <input id="t" type="text" />
      <input id="c" type="checkbox" />
      <textarea id="a"></textarea>`;
    expect(pageIsBusy()).toBe(false);
    document.getElementById("b")!.focus();
    expect(pageIsBusy()).toBe(false);
    document.getElementById("c")!.focus();
    expect(pageIsBusy()).toBe(false);
    document.getElementById("t")!.focus();
    expect(pageIsBusy()).toBe(true);
    document.getElementById("a")!.focus();
    expect(pageIsBusy()).toBe(true);
    document.getElementById("b")!.focus();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);
    expect(pageIsBusy()).toBe(true);
    document.body.innerHTML = "";
  });
});
