import { fileURLToPath } from "node:url";
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
} from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import type { Construct } from "constructs";

export interface WorkoutTrackerStackProps extends StackProps {
  /** Selects the SSM parameter path the Lambda is allowed to read. */
  readonly stage: "production" | "dev";
  /** Apex domain. Canonical origin: `www` only ever 301s here. */
  readonly domainName: string;
  /** The zone Route 53 created with the registration. Referenced, never created. */
  readonly hostedZoneId: string;
  /**
   * Certificate covering the apex and `*.<domainName>`, issued in us-east-1 by
   * `CertificateStack`. Crossing regions is what `crossRegionReferences` on
   * both stacks is for.
   */
  readonly certificateArn: string;
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

    const { stage, domainName, hostedZoneId, certificateArn } = props;
    const wwwDomainName = `www.${domainName}`;

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
          StringEquals: {
            "kms:ViaService": `ssm.${this.region}.amazonaws.com`,
          },
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
    // Redirects `www` to the apex and rewrites client-side routes to the SPA
    // entry point. Source lives in its own file with its own unit tests
    // (`lib/edge/viewer-request.test.ts`, which evaluates these exact bytes),
    // because it now has two ways to break something important: a bad rewrite
    // breaks /api/*, a bad redirect breaks auth.
    const viewerRequest = new cloudfront.Function(
      this,
      "ViewerRequestFunction",
      {
        runtime: cloudfront.FunctionRuntime.JS_2_0,
        comment:
          "Redirect www to apex; rewrite client-side routes to /index.html",
        code: cloudfront.FunctionCode.fromFile({
          filePath: fileURLToPath(
            new URL("./edge/viewer-request.js", import.meta.url),
          ),
        }),
      },
    );

    const viewerRequestAssociation = [
      {
        function: viewerRequest,
        eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
      },
    ];

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: `workout-tracker ${stage}`,
      domainNames: [domainName, wwwDomainName],
      certificate: acm.Certificate.fromCertificateArn(
        this,
        "SiteCertificate",
        certificateArn,
      ),
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
        functionAssociations: viewerRequestAssociation,
      },
      additionalBehaviors: {
        "/api/*": {
          origin:
            origins.FunctionUrlOrigin.withOriginAccessControl(apiFunctionUrl),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
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
          //
          // The viewer-request function runs here too, so `www` redirects for
          // API paths as well and the API has exactly one origin. It guards
          // /api/* out of the SPA rewrite; that guard is the single most
          // load-bearing line in the file and is tested directly.
          functionAssociations: viewerRequestAssociation,
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

    // ---------------------------------------------------------------------
    // DNS. The zone already exists -- Route 53 created it with the domain
    // registration -- so it is referenced by id, never declared. Creating a
    // second zone for the same name would publish an NS record set the
    // registrar does not delegate to, and the symptom reads as a propagation
    // delay rather than a mistake.
    //
    // By id rather than `HostedZone.fromLookup` on purpose: a lookup needs live
    // AWS credentials at synth time, which would drag an SSO session into
    // `cdk synth`, the tests, and any future CI synth -- and it silently
    // substitutes a dummy zone when it cannot run.
    // ---------------------------------------------------------------------
    const zone = route53.HostedZone.fromHostedZoneAttributes(this, "Zone", {
      hostedZoneId,
      zoneName: domainName,
    });

    const distributionTarget = route53.RecordTarget.fromAlias(
      new targets.CloudFrontTarget(distribution),
    );

    // A and AAAA for both names: CloudFront is dual-stack, and an IPv6-only
    // client with no AAAA record simply cannot reach the site.
    for (const [id, recordName] of [
      ["Apex", domainName],
      ["Www", wwwDomainName],
    ] as const) {
      new route53.ARecord(this, `${id}ARecord`, {
        zone,
        recordName,
        target: distributionTarget,
      });
      new route53.AaaaRecord(this, `${id}AaaaRecord`, {
        zone,
        recordName,
        target: distributionTarget,
      });
    }

    // Clerk's production instance. These five names are CNAMEd to Clerk, so
    // CloudFront never sees them and the wildcard certificate is simply unused
    // for them -- Clerk serves their TLS. There is no collision to worry about
    // because the distribution claims only the apex and `www`, never `*`.
    //
    // In CDK rather than the console like every other record: a console-made
    // record is invisible to `cdk diff` and gets either silently reverted or
    // silently kept forever.
    //
    // `ovnv81phd63o` is this instance's own subdomain in Clerk's mail
    // infrastructure; it is not a secret, and it is per-instance, so these
    // values do not transfer to another Clerk application.
    const clerkRecords = {
      // Routes authentication requests through the custom domain.
      clerk: "frontend-api.clerk.services",
      // Clerk's hosted account portal.
      accounts: "accounts.clerk.services",
      // Email sending and receiving, then the two DKIM signing keys. These
      // three verify more slowly than the two above; that lag is propagation.
      clkmail: "mail.ovnv81phd63o.clerk.services",
      "clk._domainkey": "dkim1.ovnv81phd63o.clerk.services",
      "clk2._domainkey": "dkim2.ovnv81phd63o.clerk.services",
    } as const;

    for (const [recordName, target] of Object.entries(clerkRecords)) {
      new route53.CnameRecord(this, `Clerk-${recordName}`, {
        zone,
        recordName,
        domainName: target,
      });
    }

    new s3deploy.BucketDeployment(this, "SiteDeployment", {
      sources: [
        s3deploy.Source.asset(props.webDistPath ?? `${repoRoot}apps/web/dist`),
      ],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ["/*"],
    });

    new CfnOutput(this, "SiteUrl", {
      value: `https://${domainName}`,
      description: "Canonical public entry point",
    });
    new CfnOutput(this, "HelloUrl", {
      value: `https://${domainName}/api/hello`,
      description:
        "Hello-world route: CloudFront -> Lambda Function URL -> Hono -> Neon",
    });
    new CfnOutput(this, "DistributionDomainName", {
      value: distribution.distributionDomainName,
      description:
        "CloudFront default domain, for testing the edge without DNS",
    });
    new CfnOutput(this, "ApiFunctionName", { value: apiFunction.functionName });
    new CfnOutput(this, "SiteBucketName", { value: siteBucket.bucketName });
  }
}
