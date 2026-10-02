// CloudFront Function, viewer-request, attached to EVERY behaviour of the
// distribution. Two jobs, in this order:
//
//   1. Redirect the `www` host to the apex, so the app has exactly one origin.
//      That single origin is what keeps `authorizedParties` a one-entry list in
//      the API's Clerk middleware (specs step 2, decisions 2 and 13).
//   2. Rewrite extensionless paths to the SPA entry point so a client-side
//      deep link reloads correctly.
//
// Because it runs on `/api/*` as well, job 2 MUST skip anything under /api/ --
// an unguarded rewrite turns every API call into index.html, which is the
// step 1 failure mode (a real API response replaced by the HTML shell) arrived
// at from a different direction. There are unit tests for exactly that.
//
// Runtime is cloudfront-js-2.0. No `let`/`const` arrow-function assumptions
// beyond what that runtime supports, and no Node globals.
function handler(event) {
  var request = event.request;
  var host = request.headers.host ? request.headers.host.value : "";

  if (host.indexOf("www.") === 0) {
    var target = "https://" + host.slice(4) + request.uri;
    var query = serializeQueryString(request.querystring);
    if (query) {
      target = target + "?" + query;
    }
    return {
      statusCode: 301,
      statusDescription: "Moved Permanently",
      headers: { location: { value: target } },
    };
  }

  // Everything under /api/ is the Lambda's, verbatim.
  if (request.uri.indexOf("/api/") === 0) {
    return request;
  }

  // No dot in the last path segment => a client-side route, not a real asset.
  if (request.uri.indexOf(".") === -1) {
    request.uri = "/index.html";
  }

  return request;
}

// Query strings survive the redirect: a shared link or an auth callback landing
// on www must not silently lose its parameters.
function serializeQueryString(querystring) {
  var parts = [];
  for (var key in querystring) {
    if (!Object.prototype.hasOwnProperty.call(querystring, key)) {
      continue;
    }
    var entry = querystring[key];
    if (entry.multiValue) {
      for (var i = 0; i < entry.multiValue.length; i++) {
        parts.push(pair(key, entry.multiValue[i].value));
      }
    } else {
      parts.push(pair(key, entry.value));
    }
  }
  return parts.join("&");
}

function pair(key, value) {
  return value === undefined || value === "" ? key : key + "=" + value;
}
