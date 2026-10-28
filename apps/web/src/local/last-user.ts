import type { LastUser, LocalDb } from "./db.js";

/**
 * The last signed-in user on this device (design D10). The app renders from
 * local data whenever this exists, without waiting for Clerk, which can take
 * 14s to load offline. It is written only when Clerk is `ready`: in
 * `degraded` mode the signed-in state comes from an unverified cookie. It is
 * cleared only when a `ready` Clerk says nobody is signed in.
 */
export class LastUserStore {
  /** `undefined` until `load()` has read the store. */
  #value: LastUser | null | undefined = undefined;
  readonly #listeners = new Set<() => void>();

  constructor(private readonly db: LocalDb) {}

  getSnapshot = (): LastUser | null | undefined => this.#value;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  async load(): Promise<void> {
    this.#set(((await this.db.get("meta", "lastUser")) as LastUser) ?? null);
  }

  async record(user: LastUser): Promise<void> {
    await this.db.put("meta", user, "lastUser");
    this.#set(user);
  }

  async clear(): Promise<void> {
    await this.db.delete("meta", "lastUser");
    this.#set(null);
  }

  #set(value: LastUser | null): void {
    this.#value = value;
    for (const listener of this.#listeners) listener();
  }
}
