import {
  editSetRequest,
  entityId,
  finishWorkoutResponse,
  historyPageResponse,
  loggedSet,
  logSetRequest,
  sessionDetailResponse,
  startedSession,
  startFromTemplateRequest,
  startFromTemplateResponse,
  startWorkoutRequest,
  templatesResponse,
  uuidV7,
  whatsNextResponse,
  workoutContextResponse,
} from "@workout-tracker/shared";
import { ServiceError } from "@workout-tracker/services";
import { Hono, type Context } from "hono";
import type { z } from "zod";
import { requirePro, type AuthEnv } from "./auth.js";
import type { TrainingDeps } from "./services.js";

/**
 * The step 3 routes: the lifter's plan and sessions (design D5, D9). Each
 * handler parses with a `shared` schema, calls one service function and maps
 * the result -- the same functions the MCP tools will call in step 6. Reads sit
 * behind `requireAuth` alone, so a lapsed account keeps its history; every
 * write adds `requirePro` (design D11, data-model.md 3.8).
 *
 * Responses are parsed with the shared schema on the way out too, as `/me`
 * does, so the contract the web client reads is the one the server emits.
 */
export function trainingRoutes(
  deps: TrainingDeps,
  { proBypass }: { proBypass?: boolean } = {},
): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  const { services } = deps;
  const pro = requirePro({ bypass: proBypass });

  /** The service call's first two arguments, from the authenticated request. */
  const caller = async (c: Context<AuthEnv>) =>
    [await deps.database(), c.get("user").id] as const;

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
    return c.json(startFromTemplateResponse.parse(result));
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

/**
 * Validation failures are `invalid` ServiceErrors so they take the same road
 * to a 400 as the service layer's own refusals. The message names the first
 * problem and is safe to show the lifter as written.
 */
function parse<T extends z.ZodType>(
  schema: T,
  value: unknown,
  label = "request",
): z.output<T> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const where = issue?.path.length ? ` (${issue.path.join(".")})` : "";
  throw new ServiceError(
    "invalid",
    `Invalid ${label}${where}: ${issue?.message ?? "not valid"}.`,
  );
}

async function json(c: Context<AuthEnv>): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new ServiceError("invalid", "The request body must be JSON.");
  }
}
