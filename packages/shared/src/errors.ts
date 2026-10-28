import { z } from "zod";

/** The body of every non-2xx response from the API (`apps/api` writes it by hand). */
export const errorResponse = z.object({
  ok: z.literal(false),
  error: z.string(),
});
export type ErrorResponse = z.infer<typeof errorResponse>;
