import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

const ssm = new SSMClient({});

/**
 * Memoised per parameter name at module scope, so each SSM read happens once
 * per execution environment rather than once per request. The promise -- not
 * the resolved value -- is cached, so concurrent first requests share a single
 * in-flight call instead of racing to make two. A failed read is evicted, so
 * the next request retries rather than inheriting the failure for the life of
 * the environment.
 */
const cache = new Map<string, Promise<string>>();

export function getSecureParameter(name: string): Promise<string> {
  let value = cache.get(name);
  if (!value) {
    value = read(name);
    value.catch(() => cache.delete(name));
    cache.set(name, value);
  }
  return value;
}

async function read(name: string): Promise<string> {
  const result = await ssm.send(
    new GetParameterCommand({ Name: name, WithDecryption: true }),
  );
  const value = result.Parameter?.Value;
  if (!value) {
    throw new Error(`SSM parameter ${name} is empty or missing`);
  }
  return value;
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}
