import { expect, test } from "@playwright/test";
import { FakeApi } from "./support/fake-api/router.js";
import { signIn, signInHere } from "./support/session.js";

/*
 * The gate in front of every screen but `/` (apps/web CLAUDE.md, App shell):
 * a signed-out deep link goes through sign-in and comes back to itself, and
 * a signed-in visitor is never bounced while Clerk is still loading, even
 * when the device's last-user record isn't there (written a beat after
 * sign-in, or cleared).
 */

test("a deep link while signed out: sign in, then land on the link", async ({
  page,
}) => {
  const api = new FakeApi();
  const program = api.addProgram({ name: "Summer Strength", targetCycles: 4 });
  await api.install(page);

  await page.goto(`/programs/${program.id}?from=email`);
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/sign-in" &&
      url.searchParams.get("redirect_url") ===
        `/programs/${program.id}?from=email`,
  );
  await signInHere(page);

  await expect(page).toHaveURL(
    (url) =>
      url.pathname === `/programs/${program.id}` &&
      url.searchParams.get("from") === "email",
  );
  await expect(
    page.getByRole("heading", { name: "Summer Strength" }),
  ).toBeVisible();
});

test("sign-in never sends anyone to another site", async ({ page }) => {
  const api = new FakeApi();
  await api.install(page);
  await page.goto("/sign-in?redirect_url=https%3A%2F%2Fexample.com%2F");
  await signInHere(page);
  await expect(page).toHaveURL((url) => url.pathname === "/");
});

test("signed in with no device record, a deep link waits for Clerk instead of bouncing to sign-in", async ({
  page,
}) => {
  const api = new FakeApi();
  const program = api.addProgram({ name: "Summer Strength", targetCycles: 4 });
  await api.install(page);
  await signIn(page);

  // The record cleared (or not written yet): only Clerk knows who this is.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("tanren");
        open.onerror = () => reject(new Error(String(open.error)));
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("meta", "readwrite");
          tx.objectStore("meta").delete("lastUser");
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(new Error(String(tx.error)));
        };
      }),
  );

  await page.goto(`/programs/${program.id}`);
  await expect(
    page.getByRole("heading", { name: "Summer Strength" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(
    (url) => url.pathname === `/programs/${program.id}`,
  );
});
