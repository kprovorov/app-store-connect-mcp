import { AscClient } from "@asc-mcp/asc";
import { Crypto } from "@asc-mcp/crypto";
import { Database } from "@asc-mcp/db";
import { Effect, Layer, ManagedRuntime, Redacted } from "effect";
import { makeApp } from "./app";
import { clerkSession } from "./auth";
import { ApiConfig } from "./config";

const failWith = (what: string) => (error: unknown) => {
  throw new Error(`api: ${what}\n${error instanceof Error ? error.message : String(error)}`);
};

export const config = await Effect.runPromise(Effect.gen(function* () {
  return yield* ApiConfig;
})).catch(failWith("invalid configuration"));

export const runtime = ManagedRuntime.make(Layer.mergeAll(Database.layerFromEnv, Crypto.layerFromEnv, AscClient.layer));
// Layers read DATABASE_URL and ENCRYPTION_KEYS lazily. Build them now so a bad value stops startup.
await runtime.context().catch(failWith("invalid configuration"));

export default makeApp({
  webOrigin: config.webOrigin,
  runtime,
  session: clerkSession({
    secretKey: Redacted.value(config.clerkSecretKey),
    publishableKey: config.clerkPublishableKey,
    webOrigin: config.webOrigin,
  }),
});
