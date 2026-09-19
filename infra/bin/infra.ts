#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { WorkoutTrackerStack } from "../lib/workout-tracker-stack.js";

const app = new App();

// Everything lives in us-east-2 (build plan, step 0). There is currently no
// us-east-1 stack: the custom domain and its ACM certificate are deliberately
// deferred out of step 1, so CloudFront serves its default *.cloudfront.net
// name with a CloudFront-managed certificate. When the domain does land, the
// certificate must be requested in us-east-1 -- CloudFront cannot see one
// issued anywhere else -- which means a second stack pinned to that region
// and `crossRegionReferences: true` on this one.
new WorkoutTrackerStack(app, "WorkoutTrackerProduction", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: "us-east-2",
  },
  stage: "production",
  description: "Workout tracker: CloudFront, private S3, and Hono on Lambda behind a Function URL",
});
