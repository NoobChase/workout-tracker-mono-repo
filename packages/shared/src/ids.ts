import { v7 as uuidv7 } from "uuid";
import { z } from "zod";

/**
 * Mint a UUIDv7. Primary keys are minted in application code (root CLAUDE.md),
 * and the id doubles as the idempotency key, so the web client and the API use
 * this one helper rather than each importing `uuid`.
 */
export function newId(): string {
  return uuidv7();
}

/**
 * A client-minted id. Rejects every UUID that is not version 7, so a write whose
 * id was not minted by `newId()` fails validation instead of becoming a row.
 */
export const uuidV7 = z.uuidv7();

/**
 * An id the server or the catalog minted (exercise, program, workout...). Any
 * well-formed UUID is accepted: the client only echoes these back, and being
 * strict here would reject a row for a reason the lifter cannot act on.
 */
export const entityId = z.uuid();

/** An ISO-8601 instant as the device or the server writes it (`Z` or an offset). */
export const isoDateTime = z.iso.datetime({ offset: true });
