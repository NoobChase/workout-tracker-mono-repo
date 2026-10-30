import type {
  WhatsNextResponse,
  WorkoutContextResponse,
} from "@workout-tracker/shared";
import type {
  LocalDb,
  NextSnapshot,
  OutlineSnapshot,
  StoredContext,
} from "./db.js";
import type { ProgramOutline } from "./outline.js";

/**
 * Prefetched workout contexts and the last what's-next snapshot (design D9).
 * When what's next loads online, each listed workout's context is fetched and
 * stored, so a start in a basement still has the whole plan, the exercises,
 * the unit settings and last time's numbers.
 */
export class ContextCache {
  constructor(
    private readonly db: LocalDb,
    private readonly fetchContext: (
      workoutId: string,
    ) => Promise<WorkoutContextResponse>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async get(workoutId: string): Promise<StoredContext | undefined> {
    return this.db.get("contexts", workoutId);
  }

  async put(userId: string, context: WorkoutContextResponse): Promise<void> {
    await this.db.put("contexts", {
      workoutId: context.workout.id,
      userId,
      fetchedAt: this.now().toISOString(),
      context,
    });
  }

  /** The cached context, or a fresh one from the server (online only). */
  async ensure(
    workoutId: string,
    userId: string | null,
  ): Promise<WorkoutContextResponse> {
    const cached = await this.get(workoutId);
    if (cached && (userId === null || cached.userId === userId)) {
      return cached.context;
    }
    const context = await this.fetchContext(workoutId);
    if (userId) await this.put(userId, context);
    return context;
  }

  /**
   * Fetches and stores the context of every workout what's next lists, next
   * and in progress. One failure doesn't stop the rest; the ids that failed
   * are returned.
   */
  async prefetch(
    userId: string,
    next: WhatsNextResponse,
  ): Promise<{ stored: string[]; failed: string[] }> {
    return this.prefetchWorkouts(userId, [
      ...next.next.map((n) => n.workoutId),
      ...next.inProgress.map((s) => s.workoutId),
    ]);
  }

  /** Fetches and stores each workout's context; the ids that failed are returned. */
  async prefetchWorkouts(
    userId: string,
    workoutIds: readonly string[],
  ): Promise<{ stored: string[]; failed: string[] }> {
    const ids = [...new Set(workoutIds)];
    const results = await Promise.allSettled(
      ids.map(async (id) => this.put(userId, await this.fetchContext(id))),
    );
    const stored: string[] = [];
    const failed: string[] = [];
    results.forEach((result, i) =>
      (result.status === "fulfilled" ? stored : failed).push(ids[i]!),
    );
    return { stored, failed };
  }

  async saveNext(userId: string, next: WhatsNextResponse): Promise<void> {
    const snapshot: NextSnapshot = {
      userId,
      fetchedAt: this.now().toISOString(),
      next,
    };
    await this.db.put("meta", snapshot, "next");
  }

  async readNext(userId: string): Promise<NextSnapshot | null> {
    const snapshot = (await this.db.get("meta", "next")) as
      NextSnapshot | undefined;
    return snapshot?.userId === userId ? snapshot : null;
  }

  /** The active programs' outlines (`outline.ts`), replacing the last ones. */
  async saveOutline(userId: string, programs: ProgramOutline[]): Promise<void> {
    const snapshot: OutlineSnapshot = {
      userId,
      fetchedAt: this.now().toISOString(),
      programs,
    };
    await this.db.put("meta", snapshot, "outline");
  }

  async readOutline(userId: string): Promise<ProgramOutline[]> {
    const snapshot = (await this.db.get("meta", "outline")) as
      OutlineSnapshot | undefined;
    return snapshot?.userId === userId ? snapshot.programs : [];
  }

  /**
   * The user's unit settings as the newest cached context has them, for
   * plan-side screens (the builder writes new weights in the default unit).
   * `null` when nothing is cached for this user.
   */
  async units(userId: string): Promise<WorkoutContextResponse["units"] | null> {
    const mine = (await this.db.getAll("contexts")).filter(
      (c) => c.userId === userId,
    );
    mine.sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt));
    return mine[0]?.context.units ?? null;
  }

  /** Another account signed in on this device: its plan isn't theirs to see. */
  async forgetOtherUsers(userId: string): Promise<void> {
    const tx = this.db.transaction(["contexts", "meta"], "readwrite");
    let cursor = await tx.objectStore("contexts").openCursor();
    while (cursor) {
      if (cursor.value.userId !== userId) await cursor.delete();
      cursor = await cursor.continue();
    }
    const next = (await tx.objectStore("meta").get("next")) as
      NextSnapshot | undefined;
    if (next && next.userId !== userId) {
      await tx.objectStore("meta").delete("next");
    }
    const outline = (await tx.objectStore("meta").get("outline")) as
      OutlineSnapshot | undefined;
    if (outline && outline.userId !== userId) {
      await tx.objectStore("meta").delete("outline");
    }
    await tx.done;
  }
}
