import {
  createExerciseRequest,
  editExerciseRequest,
  entityId,
  exerciseNotesRequest,
  exerciseResponse,
  exercisesResponse,
  listExercisesQuery,
} from "@workout-tracker/shared";
import { Hono } from "hono";
import { requirePro, type AuthEnv } from "./auth.js";
import { callerOf, json, parse } from "./request.js";
import type { ApiDeps } from "./services.js";

/**
 * The exercise catalog (operations.md 2.1-2.4; design D11 of
 * step-4a-program-builder). Adapters only: parse with the `shared` schema,
 * call one service function, parse its result on the way out. The read sits
 * behind `requireAuth` alone; every write adds `requirePro`.
 */
export function catalogRoutes(
  deps: ApiDeps,
  { proBypass }: { proBypass?: boolean } = {},
): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  const { services } = deps;
  const pro = requirePro({ bypass: proBypass });
  const caller = callerOf(deps);
  const exerciseId = (id: string) => parse(entityId, id, "exercise id");

  app.get("/exercises", async (c) => {
    const query = parse(listExercisesQuery, c.req.query(), "query");
    const [db, user] = await caller(c);
    const result = await services.listExercises(db, user, query);
    return c.json(exercisesResponse.parse(result));
  });

  app.post("/exercises", pro, async (c) => {
    const input = parse(createExerciseRequest, await json(c));
    const [db, user] = await caller(c);
    const result = await services.createExercise(db, user, input);
    return c.json(exerciseResponse.parse(result), 201);
  });

  app.patch("/exercises/:id", pro, async (c) => {
    const id = exerciseId(c.req.param("id"));
    const input = parse(editExerciseRequest, await json(c));
    const [db, user] = await caller(c);
    const result = await services.editExercise(db, user, id, input);
    return c.json(exerciseResponse.parse(result));
  });

  app.put("/exercises/:id/notes", pro, async (c) => {
    const id = exerciseId(c.req.param("id"));
    const input = parse(exerciseNotesRequest, await json(c));
    const [db, user] = await caller(c);
    const result = await services.saveExerciseNotes(db, user, id, input);
    return c.json(exerciseResponse.parse(result));
  });

  app.post("/exercises/:id/retire", pro, async (c) => {
    const id = exerciseId(c.req.param("id"));
    const [db, user] = await caller(c);
    const result = await services.retireExercise(db, user, id);
    return c.json(exerciseResponse.parse(result));
  });

  app.post("/exercises/:id/reactivate", pro, async (c) => {
    const id = exerciseId(c.req.param("id"));
    const [db, user] = await caller(c);
    const result = await services.reactivateExercise(db, user, id);
    return c.json(exerciseResponse.parse(result));
  });

  return app;
}
