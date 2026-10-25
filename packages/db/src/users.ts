// Identity: the queries that run *before* there is a user to scope by. They are
// keyed on `clerk_user_id` because that is the only thing a verified token
// carries; everything after them is scoped by `users.id`.
import { and, eq, isNull, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { Db } from "./client";
import { users } from "./schema";
import type { UserId } from "./scope";

export type SubStatus = (typeof users.subStatus.enumValues)[number];

export interface ResolvedUser {
  id: UserId;
  subStatus: SubStatus;
  deletedAt: Date | null;
}

const resolvedColumns = {
  id: users.id,
  subStatus: users.subStatus,
  deletedAt: users.deletedAt,
};

/**
 * Maps a verified Clerk user id to the local `users` row, creating it on the
 * first request (operations.md 1.1).
 *
 * Select first, upsert only on a miss (spec step 2, decision 3). Running the
 * upsert on every request would turn each authenticated call into a real
 * UPDATE -- `DO UPDATE` writes a new row version even when nothing changes --
 * on the hottest small table, to accomplish nothing. The select is an
 * index-only hit on `users_clerk_user_id_key` and returns `sub_status` too, so
 * entitlement needs no second query.
 *
 * Concurrent first requests both miss and both insert; the loser's insert
 * conflicts and `DO UPDATE ... RETURNING` hands it the winner's row, so there
 * is exactly one row whatever the interleaving. (`DO NOTHING` would return no
 * row on that path.) The minted id is simply discarded when it loses.
 *
 * Nothing here is cached across requests, deliberately: a cached identity
 * mapping is where a race becomes a cross-tenant leak.
 */
export async function resolveUser(
  db: Db,
  clerkUserId: string,
): Promise<ResolvedUser> {
  const [existing] = await db
    .select(resolvedColumns)
    .from(users)
    .where(eq(users.clerkUserId, clerkUserId));
  if (existing) return { ...existing, id: existing.id as UserId };

  const [created] = await db
    .insert(users)
    .values({ id: uuidv7(), clerkUserId })
    .onConflictDoUpdate({
      target: users.clerkUserId,
      set: { clerkUserId: sql`excluded.clerk_user_id` },
    })
    .returning(resolvedColumns);
  if (!created) {
    throw new Error("users upsert returned no row");
  }
  return { ...created, id: created.id as UserId };
}

/**
 * Clerk's `user.deleted` webhook (operations.md 1.4). Stamps `deleted_at` and
 * nothing else; the purge job hard-deletes after the window in data-model.md 4.
 *
 * Only stamps a row not already stamped, so a redelivered webhook -- Clerk
 * retries -- leaves the original deletion time, and with it the purge date,
 * where it was. Returns whether a row changed; a user who never made an
 * authenticated request has no row, and that is not an error.
 */
export async function softDeleteUser(
  db: Db,
  clerkUserId: string,
): Promise<boolean> {
  const stamped = await db
    .update(users)
    .set({ deletedAt: sql`now()` })
    .where(and(eq(users.clerkUserId, clerkUserId), isNull(users.deletedAt)))
    .returning({ id: users.id });
  return stamped.length > 0;
}

/**
 * The entitlement rule (data-model.md 3.8), with no bypass. `PAST_DUE` does
 * not entitle -- it is distinct from `CANCELED` only so the UI can say "your
 * card failed".
 */
export function isPro(subStatus: SubStatus): boolean {
  return subStatus === "TRIALING" || subStatus === "ACTIVE";
}
