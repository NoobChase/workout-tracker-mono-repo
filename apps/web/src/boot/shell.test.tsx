import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Shell,
  type AppModule,
  type AppRootProps,
  type LandingProps,
} from "./shell.js";

function FakeLanding({ onAuth }: LandingProps) {
  return (
    <main>
      <h1>Landing</h1>
      <button onClick={() => onAuth("/sign-up")}>Get started</button>
      <button onClick={() => onAuth("/sign-in")}>Log in</button>
    </main>
  );
}

/** The app chunk, recording what it was asked to be. */
function fakeApp() {
  const mounts: AppRootProps[] = [];
  let signIn: (() => void) | null = null;
  const app: AppModule = {
    AppRoot(props) {
      mounts.push(props);
      signIn = props.onSignedIn;
      return props.active ? <p>App at {window.location.pathname}</p> : null;
    },
  };
  return { app, mounts, signedIn: () => signIn?.() };
}

/** A prefetch scheduler the test fires by hand. */
function manualIdle() {
  const tasks: (() => void)[] = [];
  return {
    whenIdle: (task: () => void) => {
      tasks.push(task);
      return () => tasks.splice(tasks.indexOf(task), 1);
    },
    run: () => tasks.splice(0).forEach((task) => task()),
    pending: () => tasks.length,
  };
}

afterEach(() => window.history.replaceState(null, "", "/"));

describe("Shell", () => {
  it("shows the landing page and fetches the app chunk only when idle", async () => {
    const { app } = fakeApp();
    const loadApp = vi.fn(() => Promise.resolve(app));
    const idle = manualIdle();
    render(
      <Shell
        Landing={FakeLanding}
        app={null}
        loadApp={loadApp}
        whenIdle={idle.whenIdle}
      />,
    );
    expect(screen.getByRole("heading", { name: "Landing" })).toBeVisible();
    expect(loadApp).not.toHaveBeenCalled();

    await act(() => {
      idle.run();
      return Promise.resolve();
    });
    expect(loadApp).toHaveBeenCalledOnce();
    // Loaded behind the page: the landing page is still what shows.
    expect(screen.getByRole("heading", { name: "Landing" })).toBeVisible();
    expect(screen.queryByText(/App at/)).toBeNull();
  });

  it("swaps to the app when Clerk reports a session, keeping the app mounted", async () => {
    const { app, mounts, signedIn } = fakeApp();
    const idle = manualIdle();
    render(
      <Shell
        Landing={FakeLanding}
        app={null}
        loadApp={() => Promise.resolve(app)}
        whenIdle={idle.whenIdle}
      />,
    );
    await act(() => {
      idle.run();
      return Promise.resolve();
    });
    expect(mounts.at(-1)?.active).toBe(false);

    act(() => signedIn());
    expect(screen.queryByRole("heading", { name: "Landing" })).toBeNull();
    expect(screen.getByText("App at /")).toBeVisible();
  });

  it("a call to action before the chunk arrives goes to Clerk once it has", async () => {
    const { app } = fakeApp();
    let arrive: (module: AppModule) => void = () => {};
    const loadApp = vi.fn(
      () => new Promise<AppModule>((resolve) => (arrive = resolve)),
    );
    const idle = manualIdle();
    render(
      <Shell
        Landing={FakeLanding}
        app={null}
        loadApp={loadApp}
        whenIdle={idle.whenIdle}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Get started" }));
    expect(loadApp).toHaveBeenCalledOnce();
    // Still on the landing page until there is something to show.
    expect(window.location.pathname).toBe("/");
    expect(screen.getByRole("heading", { name: "Landing" })).toBeVisible();

    await act(() => {
      arrive(app);
      return Promise.resolve();
    });
    expect(window.location.pathname).toBe("/sign-up");
    expect(screen.getByText("App at /sign-up")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Landing" })).toBeNull();
  });

  it("Log in goes straight to sign-in when the chunk is already here", async () => {
    const { app } = fakeApp();
    const idle = manualIdle();
    render(
      <Shell
        Landing={FakeLanding}
        app={null}
        loadApp={() => Promise.resolve(app)}
        whenIdle={idle.whenIdle}
      />,
    );
    await act(() => {
      idle.run();
      return Promise.resolve();
    });
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(screen.getByText("App at /sign-in")).toBeVisible();
  });

  it("with a recorded user it is the app from the start, and prefetches nothing", () => {
    const { app, mounts } = fakeApp();
    const loadApp = vi.fn(() => Promise.resolve(app));
    const idle = manualIdle();
    render(
      <Shell
        Landing={null}
        app={app}
        loadApp={loadApp}
        whenIdle={idle.whenIdle}
      />,
    );
    expect(screen.getByText("App at /")).toBeVisible();
    expect(mounts.every((m) => m.active)).toBe(true);
    expect(idle.pending()).toBe(0);
    expect(loadApp).not.toHaveBeenCalled();
  });
});
