#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { CertificateStack } from "../lib/certificate-stack.js";
import { WorkoutTrackerStack } from "../lib/workout-tracker-stack.js";

const app = new App();

// The domain, written down once. Registered through Route 53 on 2026-10-01 in
// this account, which created the public hosted zone as a side effect -- both
// stacks reference that zone by id and neither declares one.
//
// Registering a domain is the second and last exception to "everything is CDK
// except Neon": it is a purchase, with a payment method and ICANN contact
// details, and CloudFormation has no resource that performs one.
const domainName = "tanrenstrength.com";
const hostedZoneId = "Z06653052296L2W29VS9Q";

const account = process.env.CDK_DEFAULT_ACCOUNT;

// us-east-1 exists solely because CloudFront will only attach a viewer
// certificate issued there. Everything else is us-east-2 (build plan, step 0).
const certificates = new CertificateStack(app, "WorkoutTrackerCertificates", {
  env: { account, region: "us-east-1" },
  crossRegionReferences: true,
  domainName,
  hostedZoneId,
  description: `ACM certificate for ${domainName} and *.${domainName} (CloudFront requires us-east-1)`,
});

const production = new WorkoutTrackerStack(app, "WorkoutTrackerProduction", {
  env: { account, region: "us-east-2" },
  crossRegionReferences: true,
  stage: "production",
  domainName,
  hostedZoneId,
  certificateArn: certificates.certificate.certificateArn,
  description:
    "Workout tracker: CloudFront, private S3, and Hono on Lambda behind a Function URL",
});

// The certificate must exist before CloudFront can reference it. CDK infers
// this from the ARN reference, but stating it keeps the ordering obvious to a
// reader and survives the reference being refactored away.
production.addStackDependency(certificates);
