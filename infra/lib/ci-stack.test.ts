import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { CiStack } from "./ci-stack.js";

const REPO = "example-owner@111/example-repo@222";

function synth(): Template {
  const app = new App();
  const stack = new CiStack(app, "TestCi", {
    env: { account: "111111111111", region: "us-east-2" },
    githubRepository: REPO,
  });
  return Template.fromStack(stack);
}

function role(template: Template, roleName: string) {
  const roles = Object.values(template.findResources("AWS::IAM::Role")).filter(
    (r) => r.Properties.RoleName === roleName,
  );
  assert.equal(roles.length, 1, `expected one role named ${roleName}`);
  return roles[0]!;
}

function subjects(template: Template, roleName: string): string[] {
  const statement = role(template, roleName).Properties.AssumeRolePolicyDocument
    .Statement[0];
  return statement.Condition.StringEquals[
    "token.actions.githubusercontent.com:sub"
  ] as string[];
}

/** Every SSM parameter a role can read, as serialised ARNs. */
function ssmResources(template: Template, roleName: string): string[] {
  const roleLogicalId = Object.entries(
    template.findResources("AWS::IAM::Role"),
  ).find(([, r]) => r.Properties.RoleName === roleName)![0];
  return Object.values(template.findResources("AWS::IAM::Policy"))
    .filter((p) => JSON.stringify(p.Properties.Roles).includes(roleLogicalId))
    .flatMap(
      (p) =>
        p.Properties.PolicyDocument.Statement as Array<Record<string, unknown>>,
    )
    .filter((s) => JSON.stringify(s.Action).includes("ssm:"))
    .flatMap((s) => [s.Resource].flat().map((r) => JSON.stringify(r)));
}

describe("CiStack", () => {
  const template = synth();

  // The reason there are two roles: a pull request must never be able to read
  // the production direct string.
  it("lets only main assume the migrate role", () => {
    assert.deepEqual(subjects(template, "workout-tracker-ci-migrate"), [
      `repo:${REPO}:ref:refs/heads/main`,
    ]);
  });

  it("lets pull requests and main assume the test role", () => {
    assert.deepEqual(subjects(template, "workout-tracker-ci-test"), [
      `repo:${REPO}:pull_request`,
      `repo:${REPO}:ref:refs/heads/main`,
    ]);
  });

  it("never matches subjects with a wildcard", () => {
    for (const r of Object.values(template.findResources("AWS::IAM::Role"))) {
      const doc = JSON.stringify(r.Properties.AssumeRolePolicyDocument);
      assert.ok(
        !doc.includes("StringLike"),
        "trust policy must use StringEquals",
      );
      assert.ok(!doc.includes("*"), `wildcard in trust policy: ${doc}`);
    }
  });

  it("gives the test role the Neon key and dev string, and nothing of production", () => {
    const resources = ssmResources(template, "workout-tracker-ci-test");
    assert.equal(resources.length, 2);
    assert.ok(
      resources.some((r) =>
        r.includes(":parameter/workout-tracker/ci/neon-api-key"),
      ),
    );
    assert.ok(
      resources.some((r) =>
        r.includes(":parameter/workout-tracker/dev/database-url-direct"),
      ),
    );
    assert.ok(!resources.some((r) => r.includes("production")));
  });

  it("gives the migrate role exactly the production direct string", () => {
    const resources = ssmResources(template, "workout-tracker-ci-migrate");
    assert.equal(resources.length, 1);
    assert.ok(
      resources[0]!.includes(
        ":parameter/workout-tracker/production/database-url-direct",
      ),
    );
  });

  it("grants neither role anything that could deploy", () => {
    const actions = Object.values(template.findResources("AWS::IAM::Policy"))
      .flatMap(
        (p) =>
          p.Properties.PolicyDocument.Statement as Array<{ Action: unknown }>,
      )
      .flatMap((s) => [s.Action].flat() as string[]);
    assert.deepEqual([...new Set(actions)].sort(), [
      "kms:Decrypt",
      "ssm:GetParameter",
    ]);
  });
});
