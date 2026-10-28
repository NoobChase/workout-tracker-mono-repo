import { healthResponseSchema } from "@workout-tracker/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch, apiRequest, NetworkError } from "./api.js";
import {
  AuthNotReadyError,
  OfflineError,
  registerClerk,
  type ClerkHandle,
} from "./auth.js";

function clerk(overrides: Partial<ClerkHandle> = {}) {
  const getToken = vi.fn((options?: { skipCache?: boolean }) =>
    Promise.resolve(options?.skipCache ? "fresh-token" : "cached-token"),
  );
  const handle: ClerkHandle = {
    loaded: true,
    status: "ready",
    session: { getToken },
    user: { id: "user_1" },
    ...overrides,
  };
  return { handle, getToken };
}

const fetchMock = vi.fn<typeof fetch>();
let online = true;

beforeEach(() => {
  online = true;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  registerClerk(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const health = {
  ok: true,
  message: "ok",
  databaseTime: "2026-10-26T09:00:00.000Z",
  databaseVersion: "PostgreSQL 17.5",
  coldStart: false,
};

describe("apiFetch / apiRequest", () => {
  it("sends the token and validates the response", async () => {
    const { handle } = clerk();
    registerClerk(handle);
    fetchMock.mockResolvedValue(Response.json(health));
    await expect(apiFetch("/api/hello", healthResponseSchema)).resolves.toEqual(
      health,
    );
    const headers = new Headers(fetchMock.mock.calls[0]![1]!.headers);
    expect(headers.get("Authorization")).toBe("Bearer cached-token");
  });

  it("never calls getToken or fetch while the browser is offline", async () => {
    const { handle, getToken } = clerk();
    registerClerk(handle);
    online = false;
    await expect(
      apiRequest("/api/sets/x", { method: "PUT", body: {} }),
    ).rejects.toBeInstanceOf(OfflineError);
    expect(getToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails at once, without waiting, while Clerk hasn't loaded", async () => {
    const { handle, getToken } = clerk({ loaded: false, status: "loading" });
    registerClerk(handle);
    await expect(apiRequest("/api/next")).rejects.toBeInstanceOf(
      AuthNotReadyError,
    );
    expect(getToken).not.toHaveBeenCalled();
  });

  it("asks for a fresh token when refreshing after a 401", async () => {
    const { handle, getToken } = clerk();
    registerClerk(handle);
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await apiRequest("/api/sets/x", { method: "DELETE", refreshToken: true });
    expect(getToken).toHaveBeenCalledWith({ skipCache: true });
    expect(
      new Headers(fetchMock.mock.calls[0]![1]!.headers).get("Authorization"),
    ).toBe("Bearer fresh-token");
  });

  it("turns Clerk's clerk_offline error into OfflineError", async () => {
    const offline = Object.assign(new Error("offline"), {
      code: "clerk_offline",
    });
    const { handle } = clerk({
      session: { getToken: () => Promise.reject(offline) },
    });
    registerClerk(handle);
    await expect(apiRequest("/api/next")).rejects.toBeInstanceOf(OfflineError);
  });

  it("carries the server's reason on a rejection, and wraps a failed fetch", async () => {
    registerClerk(clerk().handle);
    fetchMock.mockResolvedValueOnce(
      Response.json(
        { ok: false, error: "That set doesn't exist." },
        { status: 404 },
      ),
    );
    const error = await apiRequest("/api/sets/x", {
      method: "PATCH",
      body: {},
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 404,
      reason: "That set doesn't exist.",
    });

    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(apiRequest("/api/next")).rejects.toBeInstanceOf(NetworkError);
  });

  it("sends no Authorization header when signed out", async () => {
    registerClerk(clerk({ session: null }).handle);
    fetchMock.mockResolvedValue(Response.json(health));
    await apiFetch("/api/hello", healthResponseSchema);
    expect(
      new Headers(fetchMock.mock.calls[0]![1]!.headers).has("Authorization"),
    ).toBe(false);
  });
});
