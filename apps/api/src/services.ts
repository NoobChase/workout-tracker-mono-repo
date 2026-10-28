import type { Db } from "@workout-tracker/db";
import type * as serviceLayer from "@workout-tracker/services";

/**
 * The service functions the routes call. Injected rather than imported by
 * `training.ts` so route tests can fake them without a database; production
 * passes the real module (`deps.ts`).
 */
export type Services = Pick<
  typeof serviceLayer,
  | "listTemplates"
  | "startProgramFromTemplate"
  | "whatsNext"
  | "getWorkoutContext"
  | "startWorkout"
  | "finishWorkout"
  | "getSession"
  | "logSet"
  | "editSet"
  | "deleteSet"
  | "getWorkoutHistory"
>;

export interface TrainingDeps {
  database(): Promise<Db>;
  services: Services;
}
