import { z } from "zod";

/** Mirrors the `weight_unit` enum in `packages/db`. */
export const weightUnit = z.enum(["LB", "KG"]);
export type WeightUnit = z.infer<typeof weightUnit>;

/** `NUMERIC(7,2)` with a `>= 0` check: 0 to 99999.99, at most two decimals. */
export const weightValue = z
  .number()
  .min(0)
  .max(99999.99)
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, {
    message: "at most 2 decimal places",
  });

/** `SMALLINT` with a `>= 0` check. */
export const repsValue = z.number().int().min(0).max(32767);

/** Sets are numbered from 1 within their session exercise. */
export const setNumber = z.number().int().min(1);
