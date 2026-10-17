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

const CLOUDFRONT = "cloudfront.amazonaws.com";

describe("WorkoutTrackerStack", () => {
  const template = synth();

  it("locks the Function URL to IAM so the bare *.lambda-url host rejects traffic", () => {
    template.hasResourceProperties("AWS::Lambda::Url", { AuthType: "AWS_IAM" });
  });

  it("signs Function URL origin requests with a lambda-type OAC", () => {
    template.hasResourceProperties("AWS::CloudFront::OriginAccessControl", {
      OriginAccessControlConfig: Match.objectLike({
        OriginAccessControlOriginType: "lambda",
        SigningBehavior: "always",
        SigningProtocol: "sigv4",
      }),
    });
  });

  // The regression this suite exists for. CDK's FunctionUrlOrigin only grants
  // InvokeFunctionUrl; without InvokeFunction alongside it, every request
  // through CloudFront is a 403 AccessDeniedException and the function is never
  // invoked, so there is no log line pointing at the cause.
  it("grants CloudFront both invoke actions the Function URL needs", () => {
    for (const action of [
      "lambda:InvokeFunctionUrl",
      "lambda:InvokeFunction",
    ]) {
      template.hasResourceProperties("AWS::Lambda::Permission", {
        Action: action,
        Principal: CLOUDFRONT,
        SourceArn: Match.anyValue(),
      });
    }
  });

  it("scopes the Lambda to its single SSM parameter, never a path wildcard", () => {
    const policies = template.findResources("AWS::IAM::Policy");
    const ssmResources = Object.values(policies)
      .flatMap(
        (policy) =>
          policy.Properties.PolicyDocument.Statement as Array<
            Record<string, unknown>
          >,
      )
      .filter((statement) => JSON.stringify(statement.Action).includes("ssm:"))
      // The ARN renders as an Fn::Join unless the partition-literal feature
      // flag is on, so compare the serialised form rather than a literal.
      .map((statement) => JSON.stringify(statement.Resource));

    assert.equal(ssmResources.length, 1, "expected exactly one ssm statement");
    const [resource] = ssmResources;
    assert.ok(
      resource?.includes(
        ":parameter/workout-tracker/production/database-url-pooled",
      ),
      `unexpected ssm resource: ${resource}`,
    );
    assert.ok(
      !resource?.includes("*"),
      `ssm resource must not be a wildcard: ${resource}`,
    );
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
});
