import { verifyWebhook } from "@clerk/backend/webhooks";
import { Hono } from "hono";

export interface WebhookDeps {
  clerkWebhookSigningSecret(): Promise<string>;
  softDeleteUser(clerkUserId: string): Promise<boolean>;
}

/**
 * `POST /webhooks/clerk`. Unauthenticated by bearer token -- Clerk calls it,
 * not a user -- and authenticated by signature instead: anything that fails
 * verification is refused before its body is believed.
 *
 * Only `user.deleted` is handled (data-model.md 4). Users are created lazily on
 * first request, not from `user.created`, and no profile field is mirrored
 * from `user.updated` (data-model.md 2.6). Every other event is acknowledged
 * and ignored, so subscribing to more in the dashboard cannot cause retries.
 */
export function clerkWebhooks(deps: WebhookDeps): Hono {
  const app = new Hono();

  app.post("/clerk", async (c) => {
    let event;
    try {
      event = await verifyWebhook(c.req.raw, {
        signingSecret: await deps.clerkWebhookSigningSecret(),
      });
    } catch (err) {
      console.warn("clerk webhook rejected", err);
      return c.json({ ok: false, error: "invalid signature" }, 400);
    }

    if (event.type === "user.deleted") {
      const clerkUserId = event.data.id;
      if (!clerkUserId) {
        return c.json({ ok: false, error: "user.deleted without an id" }, 400);
      }
      // Idempotent: a redelivery finds the row already stamped and writes
      // nothing, so a 2xx on every delivery is correct.
      await deps.softDeleteUser(clerkUserId);
    }

    return c.json({ ok: true });
  });

  return app;
}
