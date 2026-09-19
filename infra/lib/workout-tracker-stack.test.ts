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

function synth(): Template {
  const app = new App();
  const stack = new WorkoutTrackerStack(app, "TestStack", {
    env: { account: "111111111111", region: "us-east-2" },
    stage: "production",
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
    for (const action of ["lambda:InvokeFunctionUrl", "lambda:InvokeFunction"]) {
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
      .flatMap((policy) => policy.Properties.PolicyDocument.Statement as Array<Record<string, unknown>>)
      .filter((statement) => JSON.stringify(statement.Action).includes("ssm:"))
      // The ARN renders as an Fn::Join unless the partition-literal feature
      // flag is on, so compare the serialised form rather than a literal.
      .map((statement) => JSON.stringify(statement.Resource));

    assert.equal(ssmResources.length, 1, "expected exactly one ssm statement");
    const [resource] = ssmResources;
    assert.ok(
      resource?.includes(":parameter/workout-tracker/production/database-url-pooled"),
      `unexpected ssm resource: ${resource}`,
    );
    assert.ok(!resource?.includes("*"), `ssm resource must not be a wildcard: ${resource}`);
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
