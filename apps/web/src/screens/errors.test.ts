import { describe, expect, it } from "vitest";
import { ApiError } from "../api.js";
import { LocalSessionError } from "../local/sessions.js";
import { errorText, isNotEntitled } from "./errors.js";

describe("errorText", () => {
  const notSignedIn = new LocalSessionError(
    "not-signed-in",
    "Sign in to start a workout, so your sets are saved to your account.",
  );

  it("says not-signed-in plainly, in terms of what the lifter was doing", () => {
    expect(errorText(notSignedIn)).toBe(
      "Sign in to start a workout, so your sets are saved to your account.",
    );
    expect(errorText(notSignedIn, "continue")).toBe(
      "Sign in to continue this workout, so your sets are saved to your account.",
    );
  });

  it("shows the server's reason, and other local errors as written", () => {
    expect(errorText(new ApiError(409, "/api/x", "Already finished."))).toBe(
      "Already finished.",
    );
    expect(
      errorText(new LocalSessionError("finished", "This workout is finished.")),
    ).toBe("This workout is finished.");
  });

  it("knows a not-entitled answer", () => {
    expect(isNotEntitled(new ApiError(403, "/api/x", null))).toBe(true);
    expect(isNotEntitled(new ApiError(422, "/api/x", null))).toBe(false);
  });
});
