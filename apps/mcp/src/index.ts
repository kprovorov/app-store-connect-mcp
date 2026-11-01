import { AscClient } from "@asc-mcp/asc";
import { Crypto } from "@asc-mcp/crypto";
import { Database } from "@asc-mcp/db";
import { serve } from "@hono/node-server";
import { Effect, Layer, ManagedRuntime, Redacted } from "effect";
import { makeApp } from "./app";
import { clerkAuthenticate } from "./auth";
import { McpConfig, clerkIssuer } from "./config";

const exitWith = (what: string) => (error: unknown) => {
  console.error(`mcp: ${what}\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
};

const config = await Effect.runPromise(
  Effect.gen(function* () {
    return yield* McpConfig;
  }),
).catch(exitWith("invalid configuration"));

const runtime = ManagedRuntime.make(Layer.mergeAll(Database.layerFromEnv, Crypto.layerFromEnv, AscClient.layer));
// Layers read DATABASE_URL and ENCRYPTION_KEYS lazily. Build them now so a bad value stops startup.
await runtime.context().catch(exitWith("invalid configuration"));

if (config.acceptSessionTokens) console.warn("mcp: MCP_DEV_ACCEPT_SESSION_TOKENS is on. Never enable it in production.");

const app = makeApp({
  resourceUrl: config.resourceUrl,
  issuer: clerkIssuer(config.clerkPublishableKey)!,
  webOrigin: config.webOrigin,
  runtime,
  authenticate: clerkAuthenticate({
    secretKey: Redacted.value(config.clerkSecretKey),
    publishableKey: config.clerkPublishableKey,
    acceptSessionTokens: config.acceptSessionTokens,
  }),
});

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`mcp listening on http://localhost:${info.port}, resource ${config.resourceUrl}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close();
    void runtime.dispose().finally(() => process.exit(0));
  });
}
