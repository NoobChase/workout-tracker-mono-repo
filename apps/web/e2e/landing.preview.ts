import { expect, test, type Page, type Request } from "@playwright/test";
import { FakeApi } from "./support/fake-api/router.js";
import { signInHere } from "./support/session.js";

/*
 * Task 7.1 (design D2), against a production build (the `preview` project),
 * because only a build has the real chunks: the bootstrap, the landing
 * chunk (no Clerk, no data layer) and the app chunk (Clerk, the data layer,
 * the router). The API is faked; sign-in is the real Clerk development
 * instance.
 */

const APP_CHUNK = /\/assets\/app-root-[\w-]+\.js$/;
const LANDING_CHUNK = /\/assets\/landing-[\w-]+\.js$/;
/** Clerk's Frontend API, which only the app chunk talks to. */
const CLERK_API = /clerk\.accounts\.dev|clerk\.tanrenstrength\.com/;

function landingHeading(page: Page) {
  return page.getByRole("heading", { name: /Three things/ });
}

function recordRequests(page: Page): Request[] {
  const requests: Request[] = [];
  page.on("request", (request) => requests.push(request));
  return requests;
}

test("a first visit paints the landing page before the app or Clerk has loaded, then prefetches the app", async ({
  page,
}) => {
  const requests = recordRequests(page);
  // Hold the app chunk: the landing page must not need it to paint.
  let releaseApp: () => void = () => {};
  const appHeld = new Promise<void>((resolve) => (releaseApp = resolve));
  await page.route(APP_CHUNK, async (route) => {
    await appHeld;
    await route.continue();
  });

  await page.goto("/");
  await expect(landingHeading(page)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "鍛, tan: to forge" }),
  ).toBeVisible();

  // Everything the page fetched before its first contentful paint.
  const beforePaint = await page.evaluate(() => {
    const paint = performance.getEntriesByName("first-contentful-paint")[0];
    if (!paint) throw new Error("no first-contentful-paint entry");
    return performance
      .getEntriesByType("resource")
      .filter((entry) => entry.startTime < paint.startTime)
      .map((entry) => entry.name);
  });
  expect(beforePaint.some((url) => LANDING_CHUNK.test(url))).toBe(true);
  expect(beforePaint.filter((url) => APP_CHUNK.test(url))).toEqual([]);
  expect(beforePaint.filter((url) => CLERK_API.test(url))).toEqual([]);
  expect(beforePaint.filter((url) => /clerk/i.test(url))).toEqual([]);

  // Once painted and idle, the app chunk comes in behind the page.
  await expect
    .poll(() => requests.some((r) => APP_CHUNK.test(r.url())), {
      timeout: 15_000,
    })
    .toBe(true);
  releaseApp();
  // Clerk loads in it and finds nobody signed in: the landing page stays.
  await expect
    .poll(() => requests.some((r) => CLERK_API.test(r.url())), {
      timeout: 15_000,
    })
    .toBe(true);
  await page.waitForTimeout(1_000);
  await expect(landingHeading(page)).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test("Get started opens Clerk's sign-up at /sign-up, and back returns to the landing page", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("banner")
    .getByRole("link", { name: "Get started" })
    .click();
  await expect(page).toHaveURL(/\/sign-up$/);
  await expect(
    page.getByRole("heading", { name: "Create your Tanren account" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Email address" }),
  ).toBeVisible({ timeout: 30_000 });

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(landingHeading(page)).toBeVisible();

  // The trial card's call to action is sign-up too.
  await page
    .getByRole("region", { name: "Pricing" })
    .getByRole("link", { name: "Get started" })
    .click();
  await expect(page).toHaveURL(/\/sign-up$/);
});

test("Log in opens sign-in at /sign-in and lands on home; after that, / goes straight to home; signing out returns to the landing page", async ({
  page,
  context,
}) => {
  const api = new FakeApi();
  await api.install(context);

  await page.goto("/");
  await page.getByRole("banner").getByRole("link", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await signInHere(page);
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: "Start your first program" }),
  ).toBeVisible();

  // Wait for the device record of this sign-in (ClerkBridge writes it).
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<boolean>((resolve) => {
            const open = indexedDB.open("tanren");
            open.onsuccess = () => {
              const db = open.result;
              const get = db
                .transaction("meta")
                .objectStore("meta")
                .get("lastUser");
              get.onsuccess = () => {
                db.close();
                resolve(get.result !== undefined);
              };
            };
          }),
      ),
    )
    .toBe(true);

  // A new visit on this device: the bootstrap reads the record and goes
  // straight to the app; the landing chunk is never fetched.
  const next = await context.newPage();
  const requests = recordRequests(next);
  await next.goto("/");
  await expect(next.getByRole("link", { name: "Tanren, home" })).toBeVisible();
  await expect(
    next.getByRole("heading", { name: "Start your first program" }),
  ).toBeVisible();
  expect(requests.filter((r) => LANDING_CHUNK.test(r.url()))).toEqual([]);
  await expect(landingHeading(next)).toBeHidden();

  // Signing out lands on the landing page again, inside the app. (The
  // account menu opens once Clerk has loaded.)
  const signOut = next.getByText("Sign out", { exact: true });
  await expect(async () => {
    await next.getByRole("button", { name: "Open user menu" }).click();
    await expect(signOut).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await signOut.click();
  await expect(next).toHaveURL(/\/$/);
  await expect(landingHeading(next)).toBeVisible();
  await expect(next.getByRole("link", { name: "Tanren, home" })).toHaveCount(0);
});

/** Resources fetched before the first contentful paint. */
function fetchedBeforePaint(page: Page) {
  return page.evaluate(() => {
    const paint = performance.getEntriesByName("first-contentful-paint")[0];
    if (!paint) throw new Error("no first-contentful-paint entry");
    return performance
      .getEntriesByType("resource")
      .filter((entry) => entry.startTime < paint.startTime)
      .map((entry) => entry.name);
  });
}

test("/about signed out is the landing page, painted without the app chunk, with Log in", async ({
  page,
}) => {
  await page.goto("/about");
  await expect(landingHeading(page)).toBeVisible();
  const banner = page.getByRole("banner");
  await expect(banner.getByRole("link", { name: "Log in" })).toBeVisible();
  await expect(banner.getByRole("link", { name: "Open app" })).toHaveCount(0);
  const beforePaint = await fetchedBeforePaint(page);
  expect(beforePaint.some((url) => LANDING_CHUNK.test(url))).toBe(true);
  expect(beforePaint.filter((url) => APP_CHUNK.test(url))).toEqual([]);
  // Clerk loads behind it and finds nobody: the page stays at /about.
  await page.waitForTimeout(1_000);
  await expect(page).toHaveURL(/\/about$/);
});

test("signed in, About Tanren in the account menu opens /about with Open app; a hard load of /about paints it without the app chunk", async ({
  page,
  context,
}) => {
  const api = new FakeApi();
  await api.install(context);
  await page.goto("/sign-in");
  await signInHere(page);
  await expect(
    page.getByRole("heading", { name: "Start your first program" }),
  ).toBeVisible();

  // The account menu, once Clerk has loaded.
  const about = page.getByText("About Tanren", { exact: true });
  await expect(async () => {
    await page.getByRole("button", { name: "Open user menu" }).click();
    await expect(about).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await about.click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(landingHeading(page)).toBeVisible();
  const banner = page.getByRole("banner");
  await expect(banner.getByRole("link", { name: "Log in" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Get started" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Start training" })).toHaveCount(
    0,
  );
  await banner.getByRole("link", { name: "Open app" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: "Start your first program" }),
  ).toBeVisible();

  // A hard load of /about on this device: the landing chunk, "Open app"
  // from the first paint (the device record), nothing of the app before it.
  const next = await context.newPage();
  await next.goto("/about");
  await expect(landingHeading(next)).toBeVisible();
  await expect(
    next.getByRole("banner").getByRole("link", { name: "Open app" }),
  ).toBeVisible();
  const beforePaint = await fetchedBeforePaint(next);
  expect(beforePaint.filter((url) => APP_CHUNK.test(url))).toEqual([]);
  expect(beforePaint.filter((url) => CLERK_API.test(url))).toEqual([]);
  await next
    .getByRole("region", { name: "Tanren, defined" })
    .getByRole("link", { name: "Open app" })
    .click();
  await expect(next).toHaveURL(/\/$/);
  await expect(
    next.getByRole("heading", { name: "Start your first program" }),
  ).toBeVisible();
});
