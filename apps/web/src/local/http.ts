import {
  historyPageResponse,
  sessionDetailResponse,
  startFromTemplateRequest,
  startFromTemplateResponse,
  templatesResponse,
  whatsNextResponse,
  workoutContextResponse,
} from "@workout-tracker/shared";
import { apiFetch, apiRequest } from "../api.js";
import type { ReadApi } from "./layer.js";
import type { Transport } from "./queue.js";

/**
 * The real API behind the data layer. Paths are the step 3 routes
 * (`apps/api/src/training.ts`); every response is validated against its
 * `packages/shared` schema.
 */
export const httpApi: ReadApi = {
  next: () => apiFetch("/api/next", whatsNextResponse),
  context: (workoutId) =>
    apiFetch(
      `/api/workouts/${encodeURIComponent(workoutId)}/context`,
      workoutContextResponse,
    ),
  templates: () => apiFetch("/api/templates", templatesResponse),
  startFromTemplate: (request) =>
    apiFetch("/api/programs/from-template", startFromTemplateResponse, {
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
