import { fileURLToPath } from "node:url";
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
} from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import type { Construct } from "constructs";

export interface WorkoutTrackerStackProps extends StackProps {
  /** Selects the SSM parameter path the Lambda is allowed to read. */
  readonly stage: "production" | "dev";
  /**
   * Built frontend assets to upload. Defaults to the real `apps/web/dist`;
   * overridden by tests so synthesis does not depend on a prior web build.
   */
  readonly webDistPath?: string;
}

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export class WorkoutTrackerStack extends Stack {
  constructor(scope: Construct, id: string, props: WorkoutTrackerStackProps) {
    super(scope, id, props);

    const { stage } = props;

    // ---------------------------------------------------------------------
    // Frontend bucket. Private: CloudFront reaches it through Origin Access
    // Control, and nothing else can reach it at all.
    // ---------------------------------------------------------------------
    const siteBucket = new s3.Bucket(this, "SiteBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // ---------------------------------------------------------------------
    // API: one Lambda running the whole Hono app, no VPC. The absence of VPC
    // configuration is the entire point of build plan step 1 -- it is what
    // buys ordinary internet access to Neon, Clerk and Stripe with no NAT
    // gateway, no interface endpoints and no RDS Proxy.
    // ---------------------------------------------------------------------
    const databaseUrlParameterName = `/workout-tracker/${stage}/database-url-pooled`;

    const apiLogGroup = new logs.LogGroup(this, "ApiFunctionLogGroup", {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const apiFunction = new NodejsFunction(this, "ApiFunction", {
      entry: `${repoRoot}apps/api/src/lambda.ts`,
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      // Generous enough to absorb a Neon autosuspend wake (~0.5s) on top of a
      // cold start without turning a first-request-of-the-day into a 502.
      timeout: Duration.seconds(30),
      logGroup: apiLogGroup,
      environment: {
        DATABASE_URL_PARAMETER_NAME: databaseUrlParameterName,
        NODE_OPTIONS: "--enable-source-maps",
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: "node22",
        // `ws` lazily requires these two native speedups and falls back to its
        // JavaScript implementations when they are absent. Leaving them
        // external stops esbuild failing on an optional dependency.
        externalModules: ["bufferutil", "utf-8-validate"],
      },
    });

    // Its single parameter, never a wildcard over the path: the runtime has no
    // business reading the direct (migration) string or the other stage's.
    apiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [
          Stack.of(this).formatArn({
            service: "ssm",
            resource: "parameter",
            resourceName: databaseUrlParameterName.slice(1),
          }),
        ],
      }),
    );

    // The parameter is a SecureString under the AWS-managed `aws/ssm` key,
    // whose id is not knowable at synth time -- so the resource is `*`, fenced
    // in by a condition that only permits decryption performed by SSM itself
    // on this role's behalf.
    apiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["kms:Decrypt"],
        resources: ["*"],
        conditions: {
          StringEquals: { "kms:ViaService": `ssm.${this.region}.amazonaws.com` },
        },
      }),
    );

    // AWS_IAM, so the bare *.lambda-url hostname rejects anonymous traffic.
    // Only CloudFront holds a credential that satisfies it.
    const apiFunctionUrl = apiFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
    });

    // ---------------------------------------------------------------------
    // CloudFront. Two origins, both reached through Origin Access Control:
    // the private bucket for the PWA, the Function URL for /api/*.
    // ---------------------------------------------------------------------
    // Rewrites extensionless paths (client-side routes) to the SPA entry point
    // so a deep link reloads correctly. Anything with a file extension falls
    // through to the real S3 key.
    const spaRouting = new cloudfront.Function(this, "SpaRoutingFunction", {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      comment: "Rewrite client-side routes to /index.html",
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.indexOf('.') === -1) {
    request.uri = '/index.html';
  }
  return request;
}
`),
    });

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: `workout-tracker ${stage}`,
      defaultRootObject: "index.html",
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100, // US-only product.
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        // SPA routing is done here, on the default behaviour only, rather than
        // with distribution-wide `errorResponses`. CloudFront applies custom
        // error responses to every behaviour including /api/*, which would
        // silently rewrite a genuine API 403 or 404 into a 200 carrying
        // index.html -- invisible now, and actively misleading once Clerk
        // starts returning 403 in step 2.
        functionAssociations: [
          {
            function: spaRouting,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
      additionalBehaviors: {
        "/api/*": {
          origin: origins.FunctionUrlOrigin.withOriginAccessControl(apiFunctionUrl),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          // Nothing behind /api/* is cacheable, and the origin request policy
          // forwards every header except Host -- the Function URL has to see
          // its own hostname for SigV4 to verify.
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy:
            cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          // No CORS response headers policy: the PWA and the API share an
          // origin, so there is no preflight to satisfy, and an
          // allow-all-origins default would be the wrong thing to carry into
          // step 2's authenticated routes.
        },
      },
    });

    // CloudFront OAC against a Function URL needs TWO grants to the service
    // principal, and CDK's `FunctionUrlOrigin.withOriginAccessControl` only
    // emits the first: `lambda:InvokeFunctionUrl` authorises the URL endpoint,
    // `lambda:InvokeFunction` authorises the invoke it performs underneath.
    // With only the former, the edge's signature verifies fine and the request
    // is then refused -- a bare AccessDeniedException from the URL authorizer,
    // with the function never invoked and so not one line in CloudWatch.
    // See the two `aws lambda add-permission` calls in
    // https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html
    apiFunction.addPermission("AllowCloudFrontInvokeFunction", {
      principal: new iam.ServicePrincipal("cloudfront.amazonaws.com"),
      action: "lambda:InvokeFunction",
      sourceArn: this.formatArn({
        service: "cloudfront",
        region: "",
        resource: "distribution",
        resourceName: distribution.distributionId,
      }),
    });

    new s3deploy.BucketDeployment(this, "SiteDeployment", {
      sources: [s3deploy.Source.asset(props.webDistPath ?? `${repoRoot}apps/web/dist`)],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ["/*"],
    });

    new CfnOutput(this, "SiteUrl", {
      value: `https://${distribution.distributionDomainName}`,
      description: "Public entry point (CloudFront default domain, no custom domain in step 1)",
    });
    new CfnOutput(this, "HelloUrl", {
      value: `https://${distribution.distributionDomainName}/api/hello`,
      description: "Hello-world route: CloudFront -> Lambda Function URL -> Hono -> Neon",
    });
    new CfnOutput(this, "ApiFunctionName", { value: apiFunction.functionName });
    new CfnOutput(this, "SiteBucketName", { value: siteBucket.bucketName });
  }
}
