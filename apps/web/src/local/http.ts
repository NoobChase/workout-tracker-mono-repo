import {
  applyPreviewResponse,
  copyProgramRequest,
  createExerciseRequest,
  createProgramRequest,
  cycleDetailResponse,
  editExerciseRequest,
  exerciseNotesRequest,
  exerciseResponse,
  exercisesResponse,
  extendProgramRequest,
  historyPageResponse,
  programDetailResponse,
  programListResponse,
  programResponse,
  renameProgramRequest,
  saveCycleRequest,
  saveCycleResponse,
  sessionDetailResponse,
  startFromTemplateRequest,
  templatesResponse,
  whatsNextResponse,
  workoutContextResponse,
} from "@workout-tracker/shared";
import { apiFetch, apiRequest } from "../api.js";
import type { ServerApi } from "./layer.js";
import type { Transport } from "./queue.js";

/**
 * The real API behind the data layer. Paths are the routes in
 * `apps/api/src/training.ts` and `programs.ts`; every request and response
 * is validated against its `packages/shared` schema.
 */
const programPath = (programId: string) =>
  `/api/programs/${encodeURIComponent(programId)}` as const;
const cyclePath = (programId: string, cycleNumber: number) =>
  `${programPath(programId)}/cycles/${cycleNumber}` as const;
const exercisePath = (exerciseId: string) =>
  `/api/exercises/${encodeURIComponent(exerciseId)}` as const;

export const httpApi: ServerApi = {
  next: () => apiFetch("/api/next", whatsNextResponse),
  context: (workoutId) =>
    apiFetch(
      `/api/workouts/${encodeURIComponent(workoutId)}/context`,
      workoutContextResponse,
    ),
  templates: () => apiFetch("/api/templates", templatesResponse),
  startFromTemplate: (request) =>
    apiFetch("/api/programs/from-template", programResponse, {
      method: "POST",
      body: startFromTemplateRequest.parse(request),
    }),
  history: (cursor) =>
    apiFetch(
      cursor === null
        ? "/api/history"
        : `/api/history?cursor=${encodeURIComponent(cursor)}`,
      historyPageResponse,
    ),
  session: (sessionId) =>
    apiFetch(
      `/api/sessions/${encodeURIComponent(sessionId)}`,
      sessionDetailResponse,
    ),
  programs: () => apiFetch("/api/programs", programListResponse),
  program: (programId) =>
    apiFetch(programPath(programId), programDetailResponse),
  cycle: (programId, cycleNumber) =>
    apiFetch(cyclePath(programId, cycleNumber), cycleDetailResponse),
  renameProgram: (programId, request) =>
    apiFetch(programPath(programId), programResponse, {
      method: "PATCH",
      body: renameProgramRequest.parse(request),
    }),
  copyProgram: (programId, request) =>
    apiFetch(`${programPath(programId)}/copy`, programResponse, {
      method: "POST",
      body: copyProgramRequest.parse(request),
    }),
  activateProgram: (programId) =>
    apiFetch(`${programPath(programId)}/activate`, programResponse, {
      method: "POST",
    }),
  archiveProgram: (programId) =>
    apiFetch(`${programPath(programId)}/archive`, programResponse, {
      method: "POST",
    }),
  extendProgram: (programId, request) =>
    apiFetch(`${programPath(programId)}/extend`, programResponse, {
      method: "POST",
      body: extendProgramRequest.parse(request),
    }),
  createProgram: (request) =>
    apiFetch("/api/programs", programResponse, {
      method: "POST",
      body: createProgramRequest.parse(request),
    }),
  applyPreview: (programId, cycleNumber) =>
    apiFetch(
      `${cyclePath(programId, cycleNumber)}/apply-preview`,
      applyPreviewResponse,
    ),
  saveCycle: (programId, cycleNumber, request) =>
    apiFetch(cyclePath(programId, cycleNumber), saveCycleResponse, {
      method: "PUT",
      body: saveCycleRequest.parse(request),
    }),
  exercises: () =>
    apiFetch("/api/exercises?includeRetired=1", exercisesResponse),
  createExercise: (request) =>
    apiFetch("/api/exercises", exerciseResponse, {
      method: "POST",
      body: createExerciseRequest.parse(request),
    }),
  editExercise: (exerciseId, request) =>
    apiFetch(exercisePath(exerciseId), exerciseResponse, {
      method: "PATCH",
      body: editExerciseRequest.parse(request),
    }),
  saveExerciseNotes: (exerciseId, request) =>
    apiFetch(`${exercisePath(exerciseId)}/notes`, exerciseResponse, {
      method: "PUT",
      body: exerciseNotesRequest.parse(request),
    }),
  retireExercise: (exerciseId) =>
    apiFetch(`${exercisePath(exerciseId)}/retire`, exerciseResponse, {
      method: "POST",
    }),
  reactivateExercise: (exerciseId) =>
    apiFetch(`${exercisePath(exerciseId)}/reactivate`, exerciseResponse, {
      method: "POST",
    }),
};

/**
 * How the queue sends one item. The body was validated when it was queued;
 * the response body is not needed (the local record is already what the
 * lifter sees), so only the status matters, through `apiRequest`'s errors.
 */
export const httpTransport: Transport = async (
  request,
  { refreshToken, signal },
) => {
  await apiRequest(request.path, {
    method: request.method,
    body: request.body,
    refreshToken,
    signal,
  });
};
