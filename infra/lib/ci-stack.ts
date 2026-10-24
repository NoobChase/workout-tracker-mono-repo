import { CfnOutput, Duration, Stack, type StackProps } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";

export interface CiStackProps extends StackProps {
  /**
   * The GitHub repository allowed to assume the roles, in the immutable
   * `owner@ownerId/name@repoId` form its OIDC `sub` claims carry. Read it from
   * `sub_claim_prefix` in `gh api repos/{owner}/{name}/actions/oidc/customization/sub`.
   */
  readonly githubRepository: string;
}

/**
 * GitHub Actions' access to AWS, by OIDC (specs step 2, decision 10). GitHub
 * holds no secrets: only these role ARNs, which are not secret. Everything a
 * job needs -- the Neon API key, the direct connection strings -- is read from
 * SSM through one of two roles:
 *
 * - **test**: the Neon API key (ephemeral test branches) and the `dev` direct
 *   string. Assumable from pull requests, and from `main` so the migrate
 *   workflow can bring `dev` up to date with what merged.
 * - **migrate**: the `production` direct string. Assumable from `main` only, so
 *   no pull request can ever read it.
 *
 * Neither can deploy. Deploys run from a laptop in step 2; widening these roles
 * is meant to be a visible decision, not an inherited permission.
 *
 * Its own stack because the OIDC provider is account-wide and the roles span
 * both stages -- neither belongs to `WorkoutTrackerProduction`.
 */
export class CiStack extends Stack {
  constructor(scope: Construct, id: string, props: CiStackProps) {
    super(scope, id, props);

    const issuer = "token.actions.githubusercontent.com";

    // Native AWS::IAM::OIDCProvider, no custom-resource Lambda. No thumbprints:
    // IAM validates GitHub's certificate against its own trusted CAs.
    const provider = new iam.OidcProviderNative(this, "GitHubOidc", {
      url: `https://${issuer}`,
      clientIds: ["sts.amazonaws.com"],
    });

    // `sub` claims GitHub issues for this repository: one per pull request
    // event, one per push to a ref. The repository uses immutable subject
    // claims, which pin the owner and repository ids -- a renamed, deleted or
    // re-created repository of the same name cannot match.
    const repo = `repo:${props.githubRepository}`;
    const fromPullRequest = `${repo}:pull_request`;
    const fromMain = `${repo}:ref:refs/heads/main`;

    const assumableFrom = (subjects: string[]) =>
      new iam.WebIdentityPrincipal(provider.oidcProviderArn, {
        // StringEquals with a list is "any of these", exactly. Never StringLike
        // with a wildcard: an unanchored `*` is how "any branch" quietly
        // becomes "any repository".
        StringEquals: {
          [`${issuer}:aud`]: "sts.amazonaws.com",
          [`${issuer}:sub`]: subjects,
        },
      });

    const parameterArn = (name: string) =>
      this.formatArn({
        service: "ssm",
        resource: "parameter",
        resourceName: name.slice(1),
      });

    const readParameters = (role: iam.Role, names: string[]) => {
      role.addToPolicy(
        new iam.PolicyStatement({
          actions: ["ssm:GetParameter"],
          resources: names.map(parameterArn),
        }),
      );
      // Same fence as the API Lambda: the `aws/ssm` key id is not knowable at
      // synth time, so `*` -- but only for decryption SSM performs on our behalf.
      role.addToPolicy(
        new iam.PolicyStatement({
          actions: ["kms:Decrypt"],
          resources: ["*"],
          conditions: {
            StringEquals: {
              "kms:ViaService": `ssm.${this.region}.amazonaws.com`,
            },
          },
        }),
      );
    };

    const testRole = new iam.Role(this, "TestRole", {
      roleName: "workout-tracker-ci-test",
      description:
        "GitHub Actions: Neon API key and the dev direct connection string",
      assumedBy: assumableFrom([fromPullRequest, fromMain]),
      maxSessionDuration: Duration.hours(1),
    });
    readParameters(testRole, [
      "/workout-tracker/ci/neon-api-key",
      "/workout-tracker/dev/database-url-direct",
    ]);

    const migrateRole = new iam.Role(this, "MigrateRole", {
      roleName: "workout-tracker-ci-migrate",
      description:
        "GitHub Actions on main only: the production direct connection string",
      assumedBy: assumableFrom([fromMain]),
      maxSessionDuration: Duration.hours(1),
    });
    readParameters(migrateRole, [
      "/workout-tracker/production/database-url-direct",
    ]);

    // Copy these into the repository's Actions variables (not secrets).
    new CfnOutput(this, "TestRoleArn", { value: testRole.roleArn });
    new CfnOutput(this, "MigrateRoleArn", { value: migrateRole.roleArn });
  }
}
