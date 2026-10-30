import { describe, expect, it } from "vitest";
import { afterSignIn } from "./auth-gate.js";

describe("afterSignIn (where a deep link returns after sign-in)", () => {
  const at = (redirect: string) =>
    afterSignIn(`?${new URLSearchParams({ redirect_url: redirect })}`);

  it("returns a path on this origin, with its query and hash", () => {
    expect(at("/programs/abc/cycles/2?x=1#top")).toBe(
      "/programs/abc/cycles/2?x=1#top",
    );
  });

  it("is home with no redirect", () => {
    expect(afterSignIn("")).toBe("/");
  });

  it("never leaves the origin or loops back to the auth pages", () => {
    for (const bad of [
      "https://example.com/",
      "//example.com/x",
      "/\\example.com",
      "javascript:alert(1)",
      "programs",
      "/sign-in",
      "/sign-up/verify",
    ]) {
      expect(at(bad)).toBe("/");
    }
  });
});
