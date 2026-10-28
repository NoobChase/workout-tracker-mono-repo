// Shared by the api test files: fake dependencies, the CloudFront-fronted app
// and the bearer helper. No database and no network -- the services are fakes
// (the real ones are tested against Neon in packages/services).
import { randomBytes, randomUUID } from "node:crypto";
import type { Db, ResolvedUser, UserId } from "@workout-tracker/db";
import { createApp, type AppDeps, type AppOptions } from "../src/app";
import { ORIGIN_VERIFY_HEADER } from "../src/origin";
import type { Services } from "../src/services";

export const SIGNING_SECRET = `whsec_${randomBytes(24).toString("base64")}`;
export const ORIGIN_SECRET = randomBytes(24).toString("base64");

/** Stands in for the connection: the fakes never touch it, tests compare it. */
export const FAKE_DB = { fake: "db" } as unknown as Db;

export interface Fakes {
  deps: AppDeps;
  users: Map<string, ResolvedUser>;
  softDeleted: string[];
}

/** Services that fail loudly: a test that reaches one it did not fake is wrong. */
export function unfakedServices(): Services {
  const unexpected = (name: string) => () =>
    Promise.reject(new Error(`unexpected call to services.${name}`));
  return {
    listTemplates: unexpected("listTemplates"),
    startProgramFromTemplate: unexpected("startProgramFromTemplate"),
    whatsNext: unexpected("whatsNext"),
    getWorkoutContext: unexpected("getWorkoutContext"),
    startWorkout: unexpected("startWorkout"),
    finishWorkout: unexpected("finishWorkout"),
    getSession: unexpected("getSession"),
    logSet: unexpected("logSet"),
    editSet: unexpected("editSet"),
    deleteSet: unexpected("deleteSet"),
    getWorkoutHistory: unexpected("getWorkoutHistory"),
  };
}

/** Tokens are `valid:<clerk id>`; anything else fails verification. */
export function fakes(services: Services = unfakedServices()): Fakes {
  const users = new Map<string, ResolvedUser>();
  const softDeleted: string[] = [];
  const deps: AppDeps = {
    originVerifySecret: () => Promise.resolve(ORIGIN_SECRET),
    verifySessionToken: (token) =>
      token.startsWith("valid:")
        ? Promise.resolve(token.slice("valid:".length))
        : Promise.reject(new Error("bad token")),
    resolveUser(clerkUserId) {
      let user = users.get(clerkUserId);
      if (!user) {
        user = {
          id: randomUUID() as UserId,
          subStatus: "NONE",
          deletedAt: null,
        };
        users.set(clerkUserId, user);
      }
      return Promise.resolve(user);
    },
    softDeleteUser(clerkUserId) {
      softDeleted.push(clerkUserId);
      return Promise.resolve(true);
    },
    clerkWebhookSigningSecret: () => Promise.resolve(SIGNING_SECRET),
    databaseHealth: () =>
      Promise.resolve({ now: new Date(), version: "PostgreSQL 18.6 on x" }),
    database: () => Promise.resolve(FAKE_DB),
    services,
  };
  return { deps, users, softDeleted };
}

/** The app as CloudFront reaches it: every request carries the origin secret. */
export function viaCloudFront(deps: AppDeps, options?: AppOptions) {
  const app = createApp(deps, options);
  return {
    request(path: string, init: RequestInit = {}) {
      const headers = new Headers(init.headers);
      headers.set(ORIGIN_VERIFY_HEADER, ORIGIN_SECRET);
      return app.request(path, { ...init, headers });
    },
  };
}

export const bearer = (token: string) => ({
  headers: { Authorization: `Bearer ${token}` },
});
