import { z } from "zod";
import { entityId, uuidV7 } from "./ids.js";

/** `GET /templates`: the default programs, as they read before being started. */
export const templateSummary = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  workouts: z.array(
    z.object({
      name: z.string().min(1),
      exercises: z.array(
        z.object({
          exerciseId: entityId,
          name: z.string().min(1),
          targetSets: z.number().int().min(1),
          repsMin: z.number().int().min(0),
          repsMax: z.number().int().min(0),
        }),
      ),
    }),
  ),
});
export type TemplateSummary = z.infer<typeof templateSummary>;

export const templatesResponse = z.object({
  templates: z.array(templateSummary),
});
export type TemplatesResponse = z.infer<typeof templatesResponse>;

/**
 * `POST /programs/from-template`: `programId` is the client-minted idempotency
 * key. Answered with `programResponse`, like every other program write.
 */
export const startFromTemplateRequest = z.object({
  programId: uuidV7,
  templateSlug: z.string().min(1),
});
export type StartFromTemplateRequest = z.infer<typeof startFromTemplateRequest>;
