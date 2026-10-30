import { expect, test, type Page } from "@playwright/test";
import { cp, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, resolve } from "node:path";
import { FakeApi } from "./support/fake-api/router.js";
import { signInHere } from "./support/session.js";
import { live, logSet, rows, syncLine } from "./support/workout.js";

/*
 * Design D18: a new version installs itself when that is safe. Each test
 * serves build A (the preview project's build, `.e2e/dist`) from its own
 * small static server, lets the service worker install it, then switches
 * the server to build B and lets the page find it.
 *
 * Build B is build A with one change a deploy would make: `index.html`
 * carries a marker (`<meta name="tanren-build" content="b">`) and `sw.js`
 * precaches it under a new revision, so the browser sees a byte-different
 * service worker, installs it, and leaves it waiting, exactly as after a
 * real deploy. (A second full `vite build` per run would add minutes and
 * prove nothing more: the update path is the same bytes either way.)
 */

const BUILD_A = resolve(import.meta.dirname, "../.e2e/dist");
const BENCH = "Barbell Bench Press";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

/** A static server that can switch builds, like a deploy does. */
async function serve(): Promise<{
  url: string;
  use: (dir: string) => void;
  close: () => Promise<void>;
}> {
  let root = BUILD_A;
  const server: Server = createServer((request, response) => {
    void (async () => {
      const path = normalize(
        decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname),
      );
      const file = join(root, path);
      let body: Buffer;
      let type = TYPES[extname(file)];
      try {
        if (!file.startsWith(root) || !type) throw new Error("not a file");
        body = await readFile(file);
      } catch {
        // The SPA fallback, as CloudFront does it.
        body = await readFile(join(root, "index.html"));
        type = TYPES[".html"];
      }
      const fresh = /(^|\/)(sw\.js|index\.html)$/.test(file) || !extname(file);
      response.writeHead(200, {
        "Content-Type": type!,
        "Cache-Control": fresh ? "no-cache" : "max-age=31536000, immutable",
      });
      response.end(body);
    })();
  });
  await new Promise<void>((done) => server.listen(0, "localhost", done));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://localhost:${port}`,
    use: (dir) => (root = dir),
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}

/** Build A with a marked `index.html` under a new precache revision. */
async function makeBuildB(dir: string): Promise<string> {
  await cp(BUILD_A, dir, { recursive: true });
  const html = join(dir, "index.html");
  await writeFile(
    html,
    (await readFile(html, "utf8")).replace(
      "<head>",
      '<head><meta name="tanren-build" content="b">',
    ),
  );
  const sw = join(dir, "sw.js");
  const source = await readFile(sw, "utf8");
  const changed = source.replace(
    /(\{url:"index\.html",revision:")[0-9a-f]+"/,
    '$1build-b"',
  );
  if (changed === source) throw new Error("sw.js has no index.html revision");
  await writeFile(sw, changed);
  return dir;
}

/** Which build the page is running: "b" once B's index.html is in. */
function build(page: Page) {
  return page
    .evaluate(
      () =>
        document
          .querySelector('meta[name="tanren-build"]')
          ?.getAttribute("content") ?? "a",
    )
    .catch(() => "reloading");
}

/** Installs build A's worker and puts the page under it. */
async function installA(page: Page, url: string) {
  await page.goto(`${url}/`);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  expect(
    await page.evaluate(() => navigator.serviceWorker.controller !== null),
  ).toBe(true);
}

/** A page left open asks the server for a new worker (as on coming back). */
async function checkForUpdate(page: Page) {
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration?.update();
  });
}

/** Until the new worker has installed and is waiting. */
async function waitingWorker(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration();
          return registration?.waiting?.state ?? null;
        }),
      { timeout: 30_000 },
    )
    .toBe("installed");
}

const updatePrompt = (page: Page) =>
  page.getByText("A new version of Tanren is ready");

test("signed out, the landing page takes build B by itself, with no prompt", async ({
  page,
}, testInfo) => {
  const server = await serve();
  try {
    const b = await makeBuildB(testInfo.outputPath("build-b"));
    await installA(page, server.url);
    await expect(
      page.getByRole("heading", { name: /Three things/ }),
    ).toBeVisible();
    expect(await build(page)).toBe("a");

    // The deploy. The next visit loads A from the worker's precache, finds
    // B, and B takes over with a reload nobody asked for.
    server.use(b);
    await page.goto(`${server.url}/`);
    await expect.poll(() => build(page), { timeout: 30_000 }).toBe("b");
    await expect(
      page.getByRole("heading", { name: /Three things/ }),
    ).toBeVisible();
    await expect(updatePrompt(page)).toHaveCount(0);
  } finally {
    await server.close();
  }
});

test("signed in with no workout in progress, build B waits for the next screen, then installs with no prompt", async ({
  page,
  context,
}, testInfo) => {
  const server = await serve();
  try {
    const api = new FakeApi();
    api.startTemplate("push-pull-legs");
    await api.install(context);
    const b = await makeBuildB(testInfo.outputPath("build-b"));
    await installA(page, server.url);
    await page
      .getByRole("banner")
      .getByRole("link", { name: "Log in" })
      .click();
    await signInHere(page);
    await expect(
      page.getByRole("button", { name: "Start Push" }),
    ).toBeVisible();

    server.use(b);
    await checkForUpdate(page);
    await waitingWorker(page);
    // Home stays as it is: no reload under the lifter, and no prompt.
    await page.waitForTimeout(1_500);
    expect(await build(page)).toBe("a");
    await expect(updatePrompt(page)).toHaveCount(0);

    // The next screen is the moment.
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Programs" })
      .click();
    await expect.poll(() => build(page), { timeout: 30_000 }).toBe("b");
    await expect(page).toHaveURL(/\/programs$/);
    await expect(
      page.getByRole("heading", { name: "Programs", level: 1 }),
    ).toBeVisible();
    await expect(updatePrompt(page)).toHaveCount(0);
  } finally {
    await server.close();
  }
});

test("mid-workout, build B only asks; Reload installs it and the queued set survives", async ({
  page,
  context,
}, testInfo) => {
  const server = await serve();
  try {
    const api = new FakeApi();
    api.startTemplate("push-pull-legs");
    await api.install(context);
    const b = await makeBuildB(testInfo.outputPath("build-b"));
    await installA(page, server.url);
    await page
      .getByRole("banner")
      .getByRole("link", { name: "Log in" })
      .click();
    await signInHere(page);
    await page.getByRole("button", { name: "Start Push" }).click();
    await expect(live(page, BENCH)).toBeVisible();
    const sessionId = new URL(page.url()).pathname.split("/").pop()!;
    await logSet(page, BENCH, { weight: 135, reps: 8 });

    server.use(b);
    await checkForUpdate(page);
    await expect(updatePrompt(page)).toBeVisible({ timeout: 30_000 });

    // Moving between screens is no reason to reload mid-workout.
    await page.getByRole("link", { name: "Tanren, home" }).click();
    await expect(page).toHaveURL(new RegExp(`${server.url}/$`));
    await page.waitForTimeout(1_000);
    expect(await build(page)).toBe("a");
    await expect(updatePrompt(page)).toBeVisible();
    await page.goBack();
    await expect(live(page, BENCH)).toBeVisible();

    // A set logged with no signal, then Reload: B comes from the worker's
    // precache, and the set is still queued, then delivered.
    await context.setOffline(true);
    await logSet(page, BENCH, { weight: 145, reps: 6 });
    await expect(syncLine(page)).toHaveText("1 set queued, no signal");
    await page.getByRole("button", { name: "Reload" }).click();
    await expect.poll(() => build(page), { timeout: 30_000 }).toBe("b");
    await expect(
      rows(page, BENCH).filter({ has: page.getByRole("button") }),
    ).toHaveCount(2, { timeout: 15_000 });
    await expect(syncLine(page)).toHaveText("1 set queued, no signal");

    await context.setOffline(false);
    await expect(syncLine(page)).toHaveText("All sets synced", {
      timeout: 60_000,
    });
    expect(api.setsOf(sessionId)).toEqual({
      [BENCH]: [
        [1, 135, "LB", 8],
        [2, 145, "LB", 6],
      ],
    });
  } finally {
    await server.close();
  }
});
