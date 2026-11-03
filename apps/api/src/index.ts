import { AscClient } from "@asc-mcp/asc";
import { Crypto } from "@asc-mcp/crypto";
import { Database } from "@asc-mcp/db";
import { serve } from "@hono/node-server";
import { Effect, Layer, ManagedRuntime, Redacted } from "effect";
import { makeApp } from "./app";
import { clerkSession } from "./auth";
import { ApiConfig } from "./config";

const exitWith = (what: string) => (error: unknown) => {
  console.error(`api: ${what}\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
};

const config = await Effect.runPromise(Effect.gen(function* () {
  return yield* ApiConfig;
})).catch(exitWith("invalid configuration"));

const runtime = ManagedRuntime.make(Layer.mergeAll(Database.layerFromEnv, Crypto.layerFromEnv, AscClient.layer));
// Layers read DATABASE_URL and ENCRYPTION_KEYS lazily. Build them now so a bad value stops startup.
await runtime.context().catch(exitWith("invalid configuration"));

const app = makeApp({
  webOrigin: config.webOrigin,
  runtime,
  session: clerkSession({
    secretKey: Redacted.value(config.clerkSecretKey),
    publishableKey: config.clerkPublishableKey,
    webOrigin: config.webOrigin,
  }),
});

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close();
    void runtime.dispose().finally(() => process.exit(0));
  });
}
