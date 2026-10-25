import { z } from "zod";

/**
 * `GET /api/me`: who the API resolved the caller's token to. The values mirror
 * the `sub_status` enum in `packages/db`; the API assigns a `SubStatus` into
 * this type, so a value added there and not here fails its typecheck.
 */
export const meResponseSchema = z.object({
  ok: z.literal(true),
  userId: z.uuid(),
  subStatus: z.enum(["NONE", "TRIALING", "ACTIVE", "PAST_DUE", "CANCELED"]),
});

export type MeResponse = z.infer<typeof meResponseSchema>;
