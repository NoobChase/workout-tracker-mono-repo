import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

const ssm = new SSMClient({});
const secretsManager = new SecretsManagerClient({});

/**
 * Memoised per name at module scope, so each read happens once per execution
 * environment rather than once per request. The promise -- not the resolved
 * value -- is cached, so concurrent first requests share a single in-flight
 * call instead of racing to make two. A failed read is evicted, so the next
 * request retries rather than inheriting the failure for the life of the
 * environment.
 */
const cache = new Map<string, Promise<string>>();

function memoised(key: string, read: () => Promise<string>): Promise<string> {
  let value = cache.get(key);
  if (!value) {
    value = read();
    value.catch(() => cache.delete(key));
    cache.set(key, value);
  }
  return value;
}

/** A hand-made SSM SecureString: connection strings and Clerk's keys. */
export function getSecureParameter(name: string): Promise<string> {
  return memoised(`ssm:${name}`, async () => {
    const result = await ssm.send(
      new GetParameterCommand({ Name: name, WithDecryption: true }),
    );
    const value = result.Parameter?.Value;
    if (!value) {
      throw new Error(`SSM parameter ${name} is empty or missing`);
    }
    return value;
  });
}

/**
 * A Secrets Manager secret. Only for values CDK generates and CloudFront also
 * needs at deploy time -- CloudFormation can resolve a Secrets Manager
 * reference into CloudFront's config, but not an SSM SecureString.
 */
export function getSecret(arn: string): Promise<string> {
  return memoised(`secretsmanager:${arn}`, async () => {
    const result = await secretsManager.send(
      new GetSecretValueCommand({ SecretId: arn }),
    );
    if (!result.SecretString) {
      throw new Error(`secret ${arn} has no string value`);
    }
    return result.SecretString;
  });
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}
