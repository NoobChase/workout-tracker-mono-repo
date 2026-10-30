import {
  applyPreviewResponse,
  copyProgramRequest,
  createProgramRequest,
  cycleDetailResponse,
  cycleNumberParam,
  entityId,
  extendProgramRequest,
  programDetailResponse,
  programListResponse,
  programResponse,
  renameProgramRequest,
  saveCycleRequest,
  saveCycleResponse,
} from "@workout-tracker/shared";
import { Hono, type Context } from "hono";
import { requirePro, type AuthEnv } from "./auth.js";
import { callerOf, json, parse } from "./request.js";
import type { ApiDeps } from "./services.js";

/**
 * The program builder and lifecycle (operations.md 3.1-3.12; design D3, D4,
 * D7, D8, D10 of step-4a-program-builder). Adapters only: parse with the
 * `shared` schema, call one service function, parse its result on the way
 * out. Reads sit behind `requireAuth` alone, so a lapsed account still sees
 * its programs; every write adds `requirePro`.
 *
 * `POST /programs/from-template` (step 3) is in `training.ts`; no route here
 * takes a POST on `/programs/:id` itself, so the two never collide.
 */
export function programRoutes(
  deps: ApiDeps,
  { proBypass }: { proBypass?: boolean } = {},
): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  const { services } = deps;
  const pro = requirePro({ bypass: proBypass });
  const caller = callerOf(deps);
  const programId = (c: Context<AuthEnv>) =>
    parse(entityId, c.req.param("id"), "program id");
  const cycle = (c: Context<AuthEnv>) =>
    parse(cycleNumberParam, c.req.param("n"), "cycle number");

  app.get("/programs", async (c) => {
    const [db, user] = await caller(c);
    const result = await services.listPrograms(db, user);
    return c.json(programListResponse.parse(result));
  });

  app.post("/programs", pro, async (c) => {
    const input = parse(createProgramRequest, await json(c));
    const [db, user] = await caller(c);
    const result = await services.createProgram(db, user, input);
    return c.json(programResponse.parse(result), 201);
  });

  app.get("/programs/:id", async (c) => {
    const id = programId(c);
    const [db, user] = await caller(c);
    const result = await services.getProgram(db, user, id);
    return c.json(programDetailResponse.parse(result));
  });

  app.patch("/programs/:id", pro, async (c) => {
    const id = programId(c);
    const input = parse(renameProgramRequest, await json(c));
    const [db, user] = await caller(c);
    const result = await services.renameProgram(db, user, id, input);
    return c.json(programResponse.parse(result));
  });

  app.get("/programs/:id/cycles/:n", async (c) => {
    const id = programId(c);
    const n = cycle(c);
    const [db, user] = await caller(c);
    const result = await services.getCycle(db, user, id, n);
    return c.json(cycleDetailResponse.parse(result));
  });

  app.get("/programs/:id/cycles/:n/apply-preview", async (c) => {
    const id = programId(c);
    const n = cycle(c);
    const [db, user] = await caller(c);
    const result = await services.getApplyPreview(db, user, id, n);
    return c.json(applyPreviewResponse.parse(result));
  });

  app.put("/programs/:id/cycles/:n", pro, async (c) => {
    const id = programId(c);
    const n = cycle(c);
    const input = parse(saveCycleRequest, await json(c));
    const [db, user] = await caller(c);
    const result = await services.saveCycle(db, user, id, n, input);
    return c.json(saveCycleResponse.parse(result));
  });

  app.post("/programs/:id/copy", pro, async (c) => {
    const id = programId(c);
    const input = parse(copyProgramRequest, await json(c));
    const [db, user] = await caller(c);
    const result = await services.copyProgram(db, user, id, input);
    return c.json(programResponse.parse(result), 201);
  });

  app.post("/programs/:id/activate", pro, async (c) => {
    const id = programId(c);
    const [db, user] = await caller(c);
    const result = await services.activateProgram(db, user, id);
    return c.json(programResponse.parse(result));
  });

  app.post("/programs/:id/archive", pro, async (c) => {
    const id = programId(c);
    const [db, user] = await caller(c);
    const result = await services.archiveProgram(db, user, id);
    return c.json(programResponse.parse(result));
  });

  app.post("/programs/:id/extend", pro, async (c) => {
    const id = programId(c);
    const input = parse(extendProgramRequest, await json(c));
    const [db, user] = await caller(c);
    const result = await services.extendProgram(db, user, id, input);
    return c.json(programResponse.parse(result));
  });

  return app;
}
