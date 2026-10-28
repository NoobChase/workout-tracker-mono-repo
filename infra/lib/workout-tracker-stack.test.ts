import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { WorkoutTrackerStack } from "./workout-tracker-stack.js";

// The stack asset-bundles `apps/web/dist`, which only exists after a web build.
// Tests synthesise against a stand-in so they do not depend on build ordering.
function stubWebDist(): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-web-dist-"));
  writeFileSync(join(dir, "index.html"), "<!doctype html>");
  return dir;
}

const DOMAIN = "example-test.com";
const ZONE_ID = "Z0TESTZONEID0000000";
// A us-east-1 ARN specifically: `Distribution` rejects a viewer certificate
// from any other region, and `fromCertificateArn` reads the region off the ARN.
const CERT_ARN =
  "arn:aws:acm:us-east-1:111111111111:certificate/00000000-0000-0000-0000-000000000000";

function synth(): Template {
  const app = new App();
  const stack = new WorkoutTrackerStack(app, "TestStack", {
    env: { account: "111111111111", region: "us-east-2" },
    stage: "production",
    domainName: DOMAIN,
    hostedZoneId: ZONE_ID,
    certificateArn: CERT_ARN,
    webDistPath: stubWebDist(),
  });
  return Template.fromStack(stack);
}

describe("WorkoutTrackerStack", () => {
  const template = synth();

  // The Function URL is public (OAC would overwrite the viewer's Bearer token
  // and refuse unhashed POST bodies), so CloudFront proves itself with a
  // generated secret header instead -- apps/api/src/origin.ts checks it.
  it("exposes the Function URL without IAM auth, so Authorization reaches the app", () => {
    template.hasResourceProperties("AWS::Lambda::Url", { AuthType: "NONE" });
    assert.deepEqual(
      template.findResources("AWS::CloudFront::OriginAccessControl", {
        Properties: {
          OriginAccessControlConfig: Match.objectLike({
            OriginAccessControlOriginType: "lambda",
          }),
        },
      }),
      {},
      "a lambda-type OAC would overwrite the viewer's Authorization header",
    );
  });

  it("sends the origin secret to the API origin by reference, never as a literal", () => {
    const [distribution] = Object.values(
      template.findResources("AWS::CloudFront::Distribution"),
    );
    const apiOrigins = (
      distribution!.Properties.DistributionConfig.Origins as Array<{
        OriginCustomHeaders?: Array<{
          HeaderName: string;
          HeaderValue: unknown;
        }>;
        S3OriginConfig?: unknown;
      }>
    ).filter((origin) => !origin.S3OriginConfig);
    assert.equal(apiOrigins.length, 1);
    const header = apiOrigins[0]!.OriginCustomHeaders?.find(
      (h) => h.HeaderName === "x-origin-verify",
    );
    assert.ok(header, "API origin must carry x-origin-verify");
    assert.match(
      JSON.stringify(header.HeaderValue),
      /resolve:secretsmanager:/,
      "the value must be a Secrets Manager dynamic reference",
    );
  });

  it("gives the Lambda the origin secret's ARN and read access to it alone", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: Match.objectLike({
          ORIGIN_VERIFY_SECRET_ARN: Match.anyValue(),
        }),
      },
    });
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(["secretsmanager:GetSecretValue"]),
            Resource: { Ref: Match.stringLikeRegexp("OriginVerifySecret") },
          }),
        ]),
      },
    });
  });

  it("scopes the Lambda to exactly its own SSM parameters, never a path wildcard", () => {
    const policies = template.findResources("AWS::IAM::Policy");
    const ssmStatements = Object.values(policies)
      .flatMap(
        (policy) =>
          policy.Properties.PolicyDocument.Statement as Array<
            Record<string, unknown>
          >,
      )
      .filter((statement) => JSON.stringify(statement.Action).includes("ssm:"));

    assert.equal(ssmStatements.length, 1, "expected exactly one ssm statement");
    // Each ARN renders as an Fn::Join unless the partition-literal feature
    // flag is on, so compare the serialised form rather than literals.
    const resources = [ssmStatements[0]!.Resource]
      .flat()
      .map((resource) => JSON.stringify(resource));
    const expected = [
      "database-url-pooled",
      "clerk-secret-key",
      "clerk-webhook-signing-secret",
    ];
    assert.equal(resources.length, expected.length, resources.join("\n"));
    for (const name of expected) {
      assert.ok(
        resources.some((r) =>
          r.includes(`:parameter/workout-tracker/production/${name}"`),
        ),
        `missing ssm resource for ${name}: ${resources.join("\n")}`,
      );
    }
    for (const resource of resources) {
      assert.ok(
        !resource.includes("*"),
        `ssm resource must not be a wildcard: ${resource}`,
      );
    }
  });

  it("hands the Lambda the Clerk parameter names and the azp allowlist from the domain", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: Match.objectLike({
          CLERK_SECRET_KEY_PARAMETER_NAME:
            "/workout-tracker/production/clerk-secret-key",
          CLERK_WEBHOOK_SIGNING_SECRET_PARAMETER_NAME:
            "/workout-tracker/production/clerk-webhook-signing-secret",
          CLERK_AUTHORIZED_PARTIES: `https://${DOMAIN},http://localhost:5173`,
        }),
      },
    });
  });

  it("puts no VPC configuration on the API function", () => {
    const functions = template.findResources("AWS::Lambda::Function");
    for (const fn of Object.values(functions)) {
      assert.equal(fn.Properties.VpcConfig, undefined);
    }
  });

  it("serves /api/* uncached and forwards every header except Host", () => {
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        CacheBehaviors: Match.arrayWith([
          Match.objectLike({
            PathPattern: "/api/*",
            // CachingDisabled / AllViewerExceptHostHeader managed policy ids.
            CachePolicyId: "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
            OriginRequestPolicyId: "b689b0a8-53d0-40ab-baf2-68738e2966ac",
          }),
        ]),
      }),
    });
  });

  // Distribution-wide error responses would rewrite an API 403 into a 200
  // carrying index.html, which silently breaks Clerk's responses in step 2.
  it("routes the SPA with a CloudFront function, not distribution-wide error responses", () => {
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        CustomErrorResponses: Match.absent(),
        DefaultCacheBehavior: Match.objectLike({
          FunctionAssociations: Match.arrayWith([
            Match.objectLike({ EventType: "viewer-request" }),
          ]),
        }),
      }),
    });
  });

  it("serves both the apex and www, with the us-east-1 certificate", () => {
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        Aliases: Match.arrayWith([DOMAIN, `www.${DOMAIN}`]),
        ViewerCertificate: Match.objectLike({
          AcmCertificateArn: CERT_ARN,
          SslSupportMethod: "sni-only",
        }),
      }),
    });
  });

  // The www -> apex redirect has to hold for API paths too, or the API is
  // reachable on two origins while `authorizedParties` only allows one.
  it("runs the viewer-request function on /api/* as well as the default behaviour", () => {
    const distributions = template.findResources(
      "AWS::CloudFront::Distribution",
    );
    const config =
      Object.values(distributions)[0]?.Properties.DistributionConfig;

    const apiBehavior = (
      config.CacheBehaviors as Array<Record<string, unknown>>
    ).find((behavior) => behavior.PathPattern === "/api/*");
    assert.ok(apiBehavior, "expected an /api/* behaviour");
    assert.equal(
      JSON.stringify(apiBehavior.FunctionAssociations),
      JSON.stringify(config.DefaultCacheBehavior.FunctionAssociations),
      "both behaviours must share one viewer-request function",
    );
  });

  it("points A and AAAA records for both names at the distribution", () => {
    for (const name of [`${DOMAIN}.`, `www.${DOMAIN}.`]) {
      for (const type of ["A", "AAAA"]) {
        template.hasResourceProperties("AWS::Route53::RecordSet", {
          Name: name,
          Type: type,
          HostedZoneId: ZONE_ID,
          AliasTarget: Match.objectLike({ DNSName: Match.anyValue() }),
        });
      }
    }
  });

  // A second zone for the same name would publish an NS set the registrar does
  // not delegate to; the symptom looks like slow propagation, not a bug.
  it("references the existing hosted zone and never declares one", () => {
    template.resourceCountIs("AWS::Route53::HostedZone", 0);
  });

  // Clerk's production instance will not verify without all five. They are
  // here rather than in the console so `cdk diff` can see them.
  it("declares every Clerk CNAME the production instance needs", () => {
    const expected: Record<string, string> = {
      clerk: "frontend-api.clerk.services",
      accounts: "accounts.clerk.services",
      clkmail: "mail.ovnv81phd63o.clerk.services",
      "clk._domainkey": "dkim1.ovnv81phd63o.clerk.services",
      "clk2._domainkey": "dkim2.ovnv81phd63o.clerk.services",
    };

    for (const [name, target] of Object.entries(expected)) {
      template.hasResourceProperties("AWS::Route53::RecordSet", {
        Name: `${name}.${DOMAIN}.`,
        Type: "CNAME",
        HostedZoneId: ZONE_ID,
        ResourceRecords: [target],
      });
    }

    const cnames = Object.values(
      template.findResources("AWS::Route53::RecordSet"),
    ).filter((record) => record.Properties.Type === "CNAME");
    assert.equal(
      cnames.length,
      Object.keys(expected).length,
      "an unexpected CNAME would mean a stray record in the zone",
    );
  });

  it("keeps the site bucket private", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  // Installed PWAs only learn about a deploy by revalidating the shell, so
  // sw.js and index.html must never be served from a browser cache. The shell
  // deployment is "everything except assets/", which covers both (and the
  // manifest and workbox runtime). Hashed assets keep long immutable caching.
  describe("site cache headers", () => {
    const deployments = Object.values(
      template.findResources("Custom::CDKBucketDeployment"),
    ).map((resource) => resource.Properties as Record<string, unknown>);
    const byCache = (value: string) =>
      deployments.filter(
        (d) =>
          (d.SystemMetadata as Record<string, string>)["cache-control"] ===
          value,
      );

    it("serves the shell (index.html, sw.js, ...) with no-cache", () => {
      const shell = byCache("no-cache");
      assert.equal(shell.length, 1);
      // Exclusion is by negation only: sw.js and index.html are not excluded.
      assert.deepEqual(shell[0]?.Exclude, ["assets/*"]);
      assert.equal(shell[0]?.Include, undefined);
      assert.ok(
        shell[0]?.DistributionId,
        "the shell deployment owns the CloudFront invalidation",
      );
    });

    it("serves hashed assets/ with a year-long immutable cache", () => {
      const assets = byCache("public, max-age=31536000, immutable");
      assert.equal(assets.length, 1);
      assert.deepEqual(assets[0]?.Exclude, ["*"]);
      assert.deepEqual(assets[0]?.Include, ["assets/*"]);
      assert.equal(
        assets[0]?.DistributionId,
        undefined,
        "invalidating before the shell lands could re-cache the old index.html",
      );
    });

    it("has exactly the two deployments, so no file is uncovered", () => {
      assert.equal(deployments.length, 2);
    });

    it("cannot prune across deployments: their key filters are disjoint", () => {
      // `sync --delete` skips keys its filters exclude, so disjoint filters
      // mean neither deployment deletes the other's objects.
      for (const d of deployments) {
        assert.ok(d.Exclude, "every deployment filters its keys");
      }
    });

    it("invalidates only after both deployments have uploaded", () => {
      const resources = template.findResources("Custom::CDKBucketDeployment");
      const shell = Object.values(resources).find(
        (r) => r.Properties.DistributionId,
      );
      assert.ok(
        (shell?.DependsOn as string[] | undefined)?.some((d) =>
          d.startsWith("SiteAssetsDeployment"),
        ),
        "shell deployment must depend on the assets deployment",
      );
    });
  });
});
