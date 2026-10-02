import { CfnOutput, Stack, type StackProps } from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import type { Construct } from "constructs";

export interface CertificateStackProps extends StackProps {
  /** Apex domain. The certificate covers this and `*.<domainName>`. */
  readonly domainName: string;
  /**
   * The zone Route 53 created with the registration. Referenced, never created
   * -- a second zone for the same name would publish a second NS record set
   * that the registrar does not delegate to, and nothing would resolve.
   */
  readonly hostedZoneId: string;
}

/**
 * The certificate CloudFront serves, and the only reason this project has a
 * second region. CloudFront can only attach a viewer certificate issued in
 * us-east-1, whatever region the distribution's own stack lives in.
 *
 * Deliberately nothing else lives here: the stack exists because of a regional
 * constraint, not because the certificate belongs to a separate concern.
 */
export class CertificateStack extends Stack {
  readonly certificate: acm.ICertificate;

  constructor(scope: Construct, id: string, props: CertificateStackProps) {
    super(scope, id, props);

    const { domainName, hostedZoneId } = props;

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, "Zone", {
      hostedZoneId,
      zoneName: domainName,
    });

    // Apex plus wildcard, so a later `dev.` or `staging.` subdomain needs no
    // certificate change at all (specs step 2, decision 13). A public ACM
    // certificate costs nothing regardless of how many names it carries, and
    // the wildcard validates through the same DNS record as the apex.
    //
    // `fromDns` writes the validation CNAMEs into the zone itself, so issuance
    // completes without anyone pasting a record by hand. It does block the
    // deployment until ACM observes them, which is the wall-clock wait phase 1
    // of the plan exists to start early.
    this.certificate = new acm.Certificate(this, "SiteCertificate", {
      domainName,
      subjectAlternativeNames: [`*.${domainName}`],
      validation: acm.CertificateValidation.fromDns(zone),
    });

    new CfnOutput(this, "CertificateArn", {
      value: this.certificate.certificateArn,
      description: `ACM certificate for ${domainName} and *.${domainName} (us-east-1, for CloudFront)`,
    });
  }
}
