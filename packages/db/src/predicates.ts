// Shared query predicates: conditions that every caller must spell the same
// way, so they are spelled once, here. Import them; never retype them.
import { sql, type SQL } from "drizzle-orm";
import { sessionSets } from "./schema";

/**
 * "A set that counts" (data-model.md 2.8): a real working set -- not a
 * warm-up, and not a drop/myo/rest-pause extension hanging off a working set.
 * A drop set counts as the one set it is, through its parent.
 *
 *     parent_set_id IS NULL AND kind <> 'WARMUP'
 *
 * Every count, chart, PR check and progression query over `session_sets`
 * uses this. Omitting it silently inflates counts and corrupts charts, which
 * is why it is not something to inline:
 *
 *     db.select({ n: count() })
 *       .from(sessionSets)
 *       .where(and(userScope(u).sessionSets, countsAsSet, eq(...)));
 *
 * It names the `session_sets` table itself, so it does not apply to an
 * aliased copy of the table.
 */
export const countsAsSet: SQL = sql`(${sessionSets.parentSetId} IS NULL AND ${sessionSets.kind} <> 'WARMUP')`;
