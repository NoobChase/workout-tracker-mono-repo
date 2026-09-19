import { handle } from "hono/aws-lambda";
import { app } from "./app.js";

// Lambda Function URLs speak the API Gateway v2 payload format, which is what
// Hono's aws-lambda adapter emits. No API Gateway involved -- see build plan
// step 1 for why that resource was designed out rather than configured.
export const handler = handle(app);
