import type { Db } from "@workout-tracker/db";
import type * as serviceLayer from "@workout-tracker/services";

/**
 * The service functions the routes call. Injected rather than imported by
 * the route files so route tests can fake them without a database;
 * production passes the real module (`deps.ts`).
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
  | "skipWorkout"
  | "listExercises"
  | "createExercise"
  | "editExercise"
  | "saveExerciseNotes"
  | "retireExercise"
  | "reactivateExercise"
  | "listPrograms"
  | "createProgram"
  | "getProgram"
  | "getCycle"
  | "renameProgram"
  | "copyProgram"
  | "activateProgram"
  | "archiveProgram"
  | "extendProgram"
  | "getApplyPreview"
  | "saveCycle"
>;

/** What every route file needs: a database handle and the services. */
export interface ApiDeps {
  database(): Promise<Db>;
  services: Services;
}
