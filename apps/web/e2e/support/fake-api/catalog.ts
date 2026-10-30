import {
  createExerciseRequest,
  editExerciseRequest,
  exerciseNotesRequest,
  exerciseResponse,
  exercisesResponse,
  type ExerciseListItem,
} from "@workout-tracker/shared";
import { fail, ok, type Answer } from "./fixtures.js";
import type { FakeTables } from "./programs.js";

/*
 * The exercise catalog (operations.md 2.1-2.5): the list, a custom
 * exercise's create (idempotent on its id), edit, notes, retire and
 * reactivate. Names are unique ignoring case across everything the user
 * sees; a standard exercise takes notes and nothing else.
 */

/** The catalog routes, or null if not one. */
export function catalogRoutes(
  t: FakeTables,
  method: string,
  url: URL,
  parts: string[],
  body: unknown,
): Answer | null {
  const [, , resource, id, action] = parts;
  if (resource !== "exercises") return null;
  const answer = (e: ExerciseListItem, status = 200) =>
    ok(exerciseResponse.parse({ exercise: e }), status);
  const clash = (name: string, except?: string) =>
    [...t.exercises.values()].find(
      (e) => e.id !== except && e.name.toLowerCase() === name.toLowerCase(),
    );
  if (method === "GET" && !id) {
    const all = url.searchParams.get("includeRetired") === "1";
    return ok(
      exercisesResponse.parse({
        exercises: [...t.exercises.values()]
          .filter((e) => e.isActive || (all && e.isCustom))
          .sort((a, b) => a.name.localeCompare(b.name)),
        units: t.units,
      }),
    );
  }
  if (method === "POST" && !id) {
    const req = createExerciseRequest.parse(body);
    const replay = t.exercises.get(req.id);
    if (replay) {
      return replay.isCustom
        ? answer(replay, 201)
        : fail(409, "That exercise id is already in use.");
    }
    const taken = clash(req.name);
    if (taken) return fail(409, `"${taken.name}" already exists.`);
    const e: ExerciseListItem = {
      id: req.id,
      name: req.name,
      isCustom: true,
      isActive: true,
      primaryMuscles: req.primaryMuscles,
      secondaryMuscles: req.secondaryMuscles,
      equipment: req.equipment,
      metrics: req.metrics,
      setup: null,
      cues: null,
    };
    t.exercises.set(e.id, e);
    return answer(e, 201);
  }
  const e = id ? t.exercises.get(id) : undefined;
  if (!e) return fail(404, "That exercise doesn't exist.");
  if (method === "PUT" && action === "notes") {
    const req = exerciseNotesRequest.parse(body);
    e.setup = req.setup;
    e.cues = req.cues;
    return answer(e);
  }
  const verb =
    method === "PATCH"
      ? "edited"
      : action === "retire"
        ? "retired"
        : "reactivated";
  if (!e.isCustom) {
    return fail(400, `${e.name} is a standard exercise and can't be ${verb}.`);
  }
  if (method === "PATCH" && !action) {
    const req = editExerciseRequest.parse(body);
    if (req.name !== undefined) {
      const taken = clash(req.name, e.id);
      if (taken) return fail(409, `"${taken.name}" already exists.`);
      e.name = req.name;
    }
    if (req.primaryMuscles) e.primaryMuscles = req.primaryMuscles;
    if (req.secondaryMuscles) e.secondaryMuscles = req.secondaryMuscles;
    if (req.equipment !== undefined) e.equipment = req.equipment;
    return answer(e);
  }
  if (method === "POST" && (action === "retire" || action === "reactivate")) {
    e.isActive = action === "reactivate";
    return answer(e);
  }
  return null;
}
