import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// Loads and evaluates the exact file CloudFront is given, rather than a
// re-implementation of it. `FunctionCode.fromFile` ships these bytes verbatim,
// so this is the deployed source under test.
const source = readFileSync(
  fileURLToPath(new URL("./viewer-request.js", import.meta.url)),
  "utf8",
);

interface CfRequest {
  uri: string;
  headers: Record<string, { value: string }>;
  querystring: Record<string, { value?: string; multiValue?: Array<{ value: string }> }>;
}
interface CfResponse {
  statusCode: number;
  statusDescription: string;
  headers: Record<string, { value: string }>;
}

const handler = new Function(`${source}; return handler;`)() as (event: {
  request: CfRequest;
}) => CfRequest | CfResponse;

function request(
  host: string,
  uri: string,
  querystring: CfRequest["querystring"] = {},
): CfRequest {
  return { uri, headers: { host: { value: host } }, querystring };
}

const isRedirect = (result: CfRequest | CfResponse): result is CfResponse =>
  "statusCode" in result;

function redirect(host: string, uri: string, qs?: CfRequest["querystring"]): string {
  const result = handler({ request: request(host, uri, qs) });
  assert.ok(isRedirect(result), "expected a redirect response");
  assert.equal(result.statusCode, 301);
  const location = result.headers.location;
  assert.ok(location, "redirect is missing a Location header");
  return location.value;
}

function rewritten(host: string, uri: string): string {
  const result = handler({ request: request(host, uri) });
  assert.ok(!isRedirect(result), `expected a request, got a ${(result as CfResponse).statusCode}`);
  return result.uri;
}

describe("viewer-request function", () => {
  describe("www -> apex redirect", () => {
    it("301s the apex, preserving the path", () => {
      assert.equal(redirect("www.tanrenstrength.com", "/"), "https://tanrenstrength.com/");
      assert.equal(
        redirect("www.tanrenstrength.com", "/history/123"),
        "https://tanrenstrength.com/history/123",
      );
    });

    // A shared link or an auth callback that lands on www must not lose its
    // parameters -- losing them would present as a broken sign-in, not as a
    // redirect bug.
    it("preserves the query string, single and repeated keys", () => {
      assert.equal(
        redirect("www.tanrenstrength.com", "/history", { tab: { value: "sets" } }),
        "https://tanrenstrength.com/history?tab=sets",
      );
      assert.equal(
        redirect("www.tanrenstrength.com", "/x", {
          id: { multiValue: [{ value: "1" }, { value: "2" }] },
        }),
        "https://tanrenstrength.com/x?id=1&id=2",
      );
    });

    it("keeps a valueless parameter as a bare key", () => {
      assert.equal(
        redirect("www.tanrenstrength.com", "/x", { debug: { value: "" } }),
        "https://tanrenstrength.com/x?debug",
      );
    });

    it("redirects www even for /api/*, so the API has one origin too", () => {
      assert.equal(
        redirect("www.tanrenstrength.com", "/api/hello"),
        "https://tanrenstrength.com/api/hello",
      );
    });
  });

  describe("SPA routing on the apex", () => {
    it("rewrites extensionless client-side routes to the entry point", () => {
      assert.equal(rewritten("tanrenstrength.com", "/history/123"), "/index.html");
      assert.equal(rewritten("tanrenstrength.com", "/"), "/index.html");
    });

    it("leaves real assets alone", () => {
      assert.equal(rewritten("tanrenstrength.com", "/assets/app.js"), "/assets/app.js");
      assert.equal(rewritten("tanrenstrength.com", "/manifest.webmanifest"), "/manifest.webmanifest");
    });

    // The regression that matters. This function is attached to /api/* as well,
    // so an unguarded extensionless rewrite would turn every API call into the
    // HTML shell -- step 1's failure mode reached from a different direction.
    it("never rewrites /api/*, however extensionless", () => {
      for (const uri of ["/api/hello", "/api/programs/abc", "/api/webhooks/clerk"]) {
        assert.equal(rewritten("tanrenstrength.com", uri), uri);
      }
    });
  });

  it("does not redirect when the host header is absent", () => {
    const result = handler({ request: { uri: "/", headers: {}, querystring: {} } });
    assert.ok(!isRedirect(result));
  });
});
