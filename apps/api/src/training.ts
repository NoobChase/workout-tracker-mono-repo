import {
  editSetRequest,
  entityId,
  finishWorkoutResponse,
  historyPageResponse,
  loggedSet,
  logSetRequest,
  programResponse,
  sessionDetailResponse,
  skippedSession,
  skipWorkoutRequest,
  startedSession,
  startFromTemplateRequest,
  startWorkoutRequest,
  templatesResponse,
  uuidV7,
  whatsNextResponse,
  workoutContextResponse,
} from "@workout-tracker/shared";
import { Hono } from "hono";
import { requirePro, type AuthEnv } from "./auth.js";
import { callerOf, json, parse } from "./request.js";
import type { ApiDeps } from "./services.js";

/**
 * The step 3 routes: the lifter's plan and sessions (design D5, D9), and
 * step 4a's skip (design D15). Each
 * handler parses with a `shared` schema, calls one service function and maps
 * the result -- the same functions the MCP tools will call in step 6. Reads sit
 * behind `requireAuth` alone, so a lapsed account keeps its history; every
 * write adds `requirePro` (design D11, data-model.md 3.8).
 *
 * Responses are parsed with the shared schema on the way out too, as `/me`
 * does, so the contract the web client reads is the one the server emits.
 */
export function trainingRoutes(
  deps: ApiDeps,
  { proBypass }: { proBypass?: boolean } = {},
): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  const { services } = deps;
  const pro = requirePro({ bypass: proBypass });

  const caller = callerOf(deps);

  app.get("/templates", async (c) => {
    const [db, user] = await caller(c);
    return c.json(
      templatesResponse.parse(await services.listTemplates(db, user)),
    );
  });

  app.post("/programs/from-template", pro, async (c) => {
    const input = parse(startFromTemplateRequest, await json(c));
    const [db, user] = await caller(c);
    const result = await services.startProgramFromTemplate(db, user, input);
    return c.json(programResponse.parse(result));
  });

  app.get("/next", async (c) => {
    const [db, user] = await caller(c);
    return c.json(whatsNextResponse.parse(await services.whatsNext(db, user)));
  });

  app.get("/workouts/:id/context", async (c) => {
    const id = parse(entityId, c.req.param("id"), "workout id");
    const [db, user] = await caller(c);
    const result = await services.getWorkoutContext(db, user, id);
    return c.json(workoutContextResponse.parse(result));
  });

  app.post("/workouts/:id/skip", pro, async (c) => {
    const workoutId = parse(entityId, c.req.param("id"), "workout id");
    const input = parse(skipWorkoutRequest, await json(c));
    const [db, user] = await caller(c);
    const result = await services.skipWorkout(db, user, {
      ...input,
      workoutId,
    });
    return c.json(skippedSession.parse(result));
  });

  app.put("/sessions/:id", pro, async (c) => {
    const id = parse(uuidV7, c.req.param("id"), "session id");
    const input = parse(startWorkoutRequest, await json(c));
    const [db, user] = await caller(c);
    const result = await services.startWorkout(db, user, id, input);
    return c.json(startedSession.parse(result));
  });

  app.post("/sessions/:id/finish", pro, async (c) => {
    const id = parse(entityId, c.req.param("id"), "session id");
    const [db, user] = await caller(c);
    const result = await services.finishWorkout(db, user, id);
    return c.json(finishWorkoutResponse.parse(result));
  });

  app.get("/sessions/:id", async (c) => {
    const id = parse(entityId, c.req.param("id"), "session id");
    const [db, user] = await caller(c);
    const result = await services.getSession(db, user, id);
    return c.json(sessionDetailResponse.parse(result));
  });

  app.put("/sets/:id", pro, async (c) => {
    const id = parse(uuidV7, c.req.param("id"), "set id");
    const input = parse(logSetRequest, await json(c));
    const [db, user] = await caller(c);
    return c.json(loggedSet.parse(await services.logSet(db, user, id, input)));
  });

  app.patch("/sets/:id", pro, async (c) => {
    const id = parse(entityId, c.req.param("id"), "set id");
    const input = parse(editSetRequest, await json(c));
    const [db, user] = await caller(c);
    return c.json(loggedSet.parse(await services.editSet(db, user, id, input)));
  });

  app.delete("/sets/:id", pro, async (c) => {
    const id = parse(entityId, c.req.param("id"), "set id");
    const [db, user] = await caller(c);
    await services.deleteSet(db, user, id);
    return c.body(null, 204);
  });

  app.get("/history", async (c) => {
    const [db, user] = await caller(c);
    const result = await services.getWorkoutHistory(db, user, {
      cursor: c.req.query("cursor"),
    });
    return c.json(historyPageResponse.parse(result));
  });

  return app;
}
