// The service layer (design D1): HTTP-agnostic operations, called by the
// `apps/api` routes now and the `apps/mcp` tools in step 6. Every function is
// `(db, user, ...input) => Promise<result>` and fails with `ServiceError`.
export { ServiceError, type ServiceErrorKind } from "./errors";
export type { LoggedSet } from "./rows";
export { listTemplates, startProgramFromTemplate } from "./templates";
export {
  createExercise,
  editExercise,
  listExercises,
  reactivateExercise,
  retireExercise,
  saveExerciseNotes,
} from "./catalog";
export {
  activateProgram,
  archiveProgram,
  copyProgram,
  createProgram,
  extendProgram,
  getProgram,
  listPrograms,
  renameProgram,
} from "./programs";
export { getApplyPreview, getCycle, saveCycle } from "./cycles";
export { getWorkoutContext, whatsNext } from "./next";
export {
  deleteSet,
  editSet,
  finishWorkout,
  logSet,
  skipWorkout,
  startWorkout,
  type StartedSession,
} from "./sessions";
export {
  HISTORY_PAGE_SIZE,
  getSession,
  getWorkoutHistory,
  type HistoryPageInput,
} from "./history";
