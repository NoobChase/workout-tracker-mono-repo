// The service layer (design D1): HTTP-agnostic operations, called by the
// `apps/api` routes now and the `apps/mcp` tools in step 6. Every function is
// `(db, user, ...input) => Promise<result>` and fails with `ServiceError`.
export { ServiceError, type ServiceErrorKind } from "./errors";
export type { LoggedSet } from "./rows";
export { listTemplates, startProgramFromTemplate } from "./templates";
export { getWorkoutContext, whatsNext } from "./next";
export {
  deleteSet,
  editSet,
  finishWorkout,
  logSet,
  startWorkout,
  type StartedSession,
} from "./sessions";
export {
  HISTORY_PAGE_SIZE,
  getSession,
  getWorkoutHistory,
  type HistoryPageInput,
} from "./history";
