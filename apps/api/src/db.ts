import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

// The WebSocket driver, not the HTTP one. The HTTP driver cannot do interactive
// transactions, and the clone primitive (operations.md 0.2), copy-program (3.9),
// activate (3.10) and finish-and-maybe-extend (4.13) all read a level and then
// write the next one using what they read. Choosing HTTP here would surface as a
// wall at step 4, not here.
neonConfig.webSocketConstructor = ws;

const parameterName = requireEnv("DATABASE_URL_PARAMETER_NAME");

/**
 * Memoised at module scope, so the SSM read and the pool construction both
 * happen once per execution environment rather than once per request. The
 * promise -- not the resolved pool -- is what gets cached, so concurrent first
 * requests share a single in-flight SSM call instead of racing to make two.
 */
let poolPromise: Promise<Pool> | undefined;

export function getPool(): Promise<Pool> {
  poolPromise ??= createPool();
  return poolPromise;
}

async function createPool(): Promise<Pool> {
  const ssm = new SSMClient({});
  const result = await ssm.send(
    new GetParameterCommand({ Name: parameterName, WithDecryption: true }),
  );

  const connectionString = result.Parameter?.Value;
  if (!connectionString) {
    throw new Error(`SSM parameter ${parameterName} is empty or missing`);
  }

  // Pooled (-pooler) endpoint: this is the runtime. The direct endpoint is for
  // CI migrations only, and this role cannot read that parameter.
  if (!connectionString.includes("-pooler.")) {
    throw new Error(
      `SSM parameter ${parameterName} does not point at a Neon pooled (-pooler) endpoint`,
    );
  }

  // Never `pool.end()` per request -- the point of building it out here is that
  // it survives across invocations of the same execution environment.
  return new Pool({ connectionString });
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}
