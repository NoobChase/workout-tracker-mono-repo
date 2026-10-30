import type { z } from "zod";
import type { LocalDb } from "./db.js";

/**
 * The builder's unsaved work (step 4a design D14): one record per user,
 * program and cycle, written as the lifter edits and removed when the cycle
 * is saved or the draft discarded. It is a convenience on this device only,
 * never a sync mechanism: saving is an online request (operations.md 0.3).
 *
 * The value is whatever the caller writes; a read parses it against the
 * caller's schema (the builder's is versioned, `builder/draft.ts`), and a
 * record that no longer fits, left by an older build, is discarded rather
 * than handed to a screen.
 */
export interface StoredDraft {
  /** `draftKey(...)`. */
  key: string;
  userId: string;
  /** The program, or `null` for a program being created. */
  programId: string | null;
  cycleNumber: number;
  savedAt: string;
  state: unknown;
}

/** "user|program|cycle"; a new program is "user|new|1". */
export function draftKey(
  userId: string,
  programId: string | null,
  cycleNumber: number,
): string {
  return `${userId}|${programId ?? "new"}|${cycleNumber}`;
}

export class DraftStore {
  constructor(
    private readonly db: LocalDb,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * The draft, parsed with `schema`; `undefined` when there is none, or when
   * the stored one doesn't parse (it is deleted then).
   */
  async get<T>(
    schema: z.ZodType<T>,
    userId: string,
    programId: string | null,
    cycleNumber: number,
  ): Promise<{ state: T; savedAt: string } | undefined> {
    const key = draftKey(userId, programId, cycleNumber);
    const draft = await this.db.get("drafts", key);
    // Keyed by user, so another account's draft is never read; checked
    // again here in case a key is ever built differently.
    if (!draft || draft.userId !== userId) return undefined;
    const parsed = schema.safeParse(draft.state);
    if (!parsed.success) {
      await this.db.delete("drafts", key);
      return undefined;
    }
    return { state: parsed.data, savedAt: draft.savedAt };
  }

  async put(
    userId: string,
    programId: string | null,
    cycleNumber: number,
    state: unknown,
  ): Promise<void> {
    await this.db.put("drafts", {
      key: draftKey(userId, programId, cycleNumber),
      userId,
      programId,
      cycleNumber,
      savedAt: this.now().toISOString(),
      state,
    });
  }

  async delete(
    userId: string,
    programId: string | null,
    cycleNumber: number,
  ): Promise<void> {
    await this.db.delete("drafts", draftKey(userId, programId, cycleNumber));
  }

  /** Another account signed in on this device: its drafts aren't theirs. */
  async forgetOtherUsers(userId: string): Promise<void> {
    const tx = this.db.transaction("drafts", "readwrite");
    let cursor = await tx.store.openCursor();
    while (cursor) {
      if (cursor.value.userId !== userId) await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  }
}
