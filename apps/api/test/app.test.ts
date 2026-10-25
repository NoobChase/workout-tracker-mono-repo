// The CloudFront check, the auth boundary and the Clerk webhook, through the
// real Hono app with fake identity dependencies. Token verification itself is Clerk's; what is tested
// here is everything this repo decides around it. Identity resolution against
// a real database is packages/db/test/users.test.ts.
import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import type { ResolvedUser, SubStatus } from "@workout-tracker/db";
import { Hono } from "hono";
import { createApp, type AppDeps } from "../src/app";
import { requireAuth, requirePro, type AuthEnv } from "../src/auth";
import { ORIGIN_VERIFY_HEADER } from "../src/origin";

const SIGNING_SECRET = `whsec_${randomBytes(24).toString("base64")}`;
const ORIGIN_SECRET = randomBytes(24).toString("base64");

interface Fakes {
  deps: AppDeps;
  users: Map<string, ResolvedUser>;
  softDeleted: string[];
}

/** Tokens are `valid:<clerk id>`; anything else fails verification. */
function fakes(): Fakes {
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
        user = { id: randomUUID(), subStatus: "NONE", deletedAt: null };
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
  };
  return { deps, users, softDeleted };
}

/** The app as CloudFront reaches it: every request carries the origin secret. */
function viaCloudFront(deps: AppDeps) {
  const app = createApp(deps);
  return {
    request(path: string, init: RequestInit = {}) {
      const headers = new Headers(init.headers);
      headers.set(ORIGIN_VERIFY_HEADER, ORIGIN_SECRET);
      return app.request(path, { ...init, headers });
    },
  };
}

const bearer = (token: string) => ({
  headers: { Authorization: `Bearer ${token}` },
});

describe("requireCloudFront", () => {
  const direct = () => createApp(fakes().deps);

  it("refuses a request without the origin header, public routes included", async () => {
    assert.equal((await direct().request("/api/hello")).status, 403);
    assert.equal(
      (await direct().request("/api/webhooks/clerk", { method: "POST" }))
        .status,
      403,
    );
  });

  it("runs before auth: a valid token does not get past it", async () => {
    const res = await direct().request("/api/me", bearer("valid:user_a"));
    assert.equal(res.status, 403);
  });

  it("refuses the wrong secret", async () => {
    const res = await direct().request("/api/hello", {
      headers: { [ORIGIN_VERIFY_HEADER]: `${ORIGIN_SECRET}x` },
    });
    assert.equal(res.status, 403);
  });

  it("lets the right secret through", async () => {
    const res = await viaCloudFront(fakes().deps).request("/api/hello");
    assert.equal(res.status, 200);
  });
});

describe("requireAuth", () => {
  it("refuses a request with no Authorization header", async () => {
    const res = await viaCloudFront(fakes().deps).request("/api/me");
    assert.equal(res.status, 401);
  });

  it("refuses a non-Bearer scheme", async () => {
    const res = await viaCloudFront(fakes().deps).request("/api/me", {
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
    });
    assert.equal(res.status, 401);
  });

  it("refuses a token that fails verification", async () => {
    const res = await viaCloudFront(fakes().deps).request(
      "/api/me",
      bearer("forged"),
    );
    assert.equal(res.status, 401);
  });

  it("resolves a valid token to the internal user", async () => {
    const { deps, users } = fakes();
    const res = await viaCloudFront(deps).request(
      "/api/me",
      bearer("valid:user_a"),
    );

    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      ok: true,
      userId: users.get("user_a")!.id,
      subStatus: "NONE",
    });
  });

  it("refuses a soft-deleted user even with a valid token", async () => {
    const { deps, users } = fakes();
    users.set("user_gone", {
      id: randomUUID(),
      subStatus: "ACTIVE",
      deletedAt: new Date(),
    });
    const res = await viaCloudFront(deps).request(
      "/api/me",
      bearer("valid:user_gone"),
    );
    assert.equal(res.status, 401);
  });

  it("fails closed: an unknown path is 401 signed out, 404 signed in", async () => {
    const app = viaCloudFront(fakes().deps);
    assert.equal((await app.request("/api/nope")).status, 401);
    assert.equal(
      (await app.request("/api/nope", bearer("valid:user_a"))).status,
      404,
    );
  });

  it("leaves exactly the health route and the webhook public", async () => {
    const app = viaCloudFront(fakes().deps);
    assert.equal((await app.request("/api/hello")).status, 200);
    // Reaches the handler (400: unsigned), rather than being stopped at 401.
    assert.equal(
      (await app.request("/api/webhooks/clerk", { method: "POST" })).status,
      400,
    );
    // Prefix matching would be a hole: only the exact paths are public.
    assert.equal((await app.request("/api/hello/x")).status, 401);
    assert.equal(
      (await app.request("/api/webhooks/other", { method: "POST" })).status,
      401,
    );
  });
});

describe("requirePro", () => {
  function gated(subStatus: SubStatus, options?: { bypass?: boolean }) {
    const { deps, users } = fakes();
    users.set("user_p", { id: randomUUID(), subStatus, deletedAt: null });
    const app = new Hono<AuthEnv>();
    app.use(requireAuth(deps), requirePro(options));
    app.get("/pro", (c) => c.text("in"));
    return app.request("/pro", bearer("valid:user_p"));
  }

  it("enforces isPro when billing is live", async () => {
    for (const [status, expected] of [
      ["NONE", 403],
      ["TRIALING", 200],
      ["ACTIVE", 200],
      ["PAST_DUE", 403],
      ["CANCELED", 403],
    ] as const) {
      assert.equal(
        (await gated(status, { bypass: false })).status,
        expected,
        status,
      );
    }
  });

  it("entitles everyone until step 5 deletes the bypass", async () => {
    assert.equal((await gated("NONE")).status, 200);
  });

  it("is mounted on the analytics group", async () => {
    // With the bypass on, an entitled request passes the gate and finds no
    // route yet (404) -- proving the gate runs after auth, not instead of it.
    const app = viaCloudFront(fakes().deps);
    assert.equal((await app.request("/api/analytics/x")).status, 401);
    assert.equal(
      (await app.request("/api/analytics/x", bearer("valid:user_a"))).status,
      404,
    );
  });
});

describe("POST /api/webhooks/clerk", () => {
  /** Signs like Clerk (Standard Webhooks via Svix): HMAC-SHA256 over id.ts.body. */
  function signed(payload: unknown, secret = SIGNING_SECRET) {
    const body = JSON.stringify(payload);
    const id = `msg_${randomUUID()}`;
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const key = Buffer.from(secret.slice("whsec_".length), "base64");
    const signature = createHmac("sha256", key)
      .update(`${id}.${timestamp}.${body}`)
      .digest("base64");
    return {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        "svix-id": id,
        "svix-timestamp": timestamp,
        "svix-signature": `v1,${signature}`,
      },
    };
  }

  const deletedEvent = {
    type: "user.deleted",
    object: "event",
    data: { object: "user", id: "user_deleted_1", deleted: true },
  };

  it("soft-deletes on a correctly signed user.deleted", async () => {
    const { deps, softDeleted } = fakes();
    const res = await viaCloudFront(deps).request(
      "/api/webhooks/clerk",
      signed(deletedEvent),
    );
    assert.equal(res.status, 200);
    assert.deepEqual(softDeleted, ["user_deleted_1"]);
  });

  it("refuses a body signed with another secret, and acts on nothing", async () => {
    const { deps, softDeleted } = fakes();
    const other = `whsec_${randomBytes(24).toString("base64")}`;
    const res = await viaCloudFront(deps).request(
      "/api/webhooks/clerk",
      signed(deletedEvent, other),
    );
    assert.equal(res.status, 400);
    assert.deepEqual(softDeleted, []);
  });

  it("refuses a tampered body", async () => {
    const { deps, softDeleted } = fakes();
    const request = signed(deletedEvent);
    request.body = request.body.replace("user_deleted_1", "user_victim");
    const res = await viaCloudFront(deps).request(
      "/api/webhooks/clerk",
      request,
    );
    assert.equal(res.status, 400);
    assert.deepEqual(softDeleted, []);
  });

  it("acknowledges and ignores other event types", async () => {
    const { deps, softDeleted } = fakes();
    const res = await viaCloudFront(deps).request(
      "/api/webhooks/clerk",
      signed({ type: "user.created", object: "event", data: { id: "user_x" } }),
    );
    assert.equal(res.status, 200);
    assert.deepEqual(softDeleted, []);
  });
});
