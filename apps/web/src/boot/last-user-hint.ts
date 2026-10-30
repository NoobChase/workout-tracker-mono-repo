import { DEFAULT_DB_NAME, openLocalDb } from "../local/db.js";

/**
 * Whether someone has signed in on this device before (design D2): the
 * bootstrap's one question, answered from IndexedDB in milliseconds with no
 * network. A record means the app chunk; none means the landing page.
 *
 * It reads the same `meta.lastUser` record the data layer keeps
 * (`local/last-user.ts`) and closes its connection at once, so it never holds
 * the database open against the app's own connection or a later upgrade.
 * Storage that can't be opened counts as "no": the landing page needs none,
 * and the app says what is wrong once the lifter goes on to sign in.
 */
export async function hasLastUser(dbName = DEFAULT_DB_NAME): Promise<boolean> {
  try {
    const db = await openLocalDb(dbName);
    try {
      return (await db.get("meta", "lastUser")) !== undefined;
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}
