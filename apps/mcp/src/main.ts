import { AscClient } from "@asc-mcp/asc";
import { Crypto } from "@asc-mcp/crypto";
import { Database } from "@asc-mcp/db";
import { Effect, Layer, ManagedRuntime, Redacted } from "effect";
import { makeApp } from "./app";
import { clerkAuthenticate } from "./auth";
import { McpConfig, clerkIssuer } from "./config";

const failWith = (what: string) => (error: unknown) => {
  throw new Error(`mcp: ${what}\n${error instanceof Error ? error.message : String(error)}`);
};

export const config = await Effect.runPromise(
  Effect.gen(function* () {
    return yield* McpConfig;
  }),
).catch(failWith("invalid configuration"));

export const runtime = ManagedRuntime.make(Layer.mergeAll(Database.layerFromEnv, Crypto.layerFromEnv, AscClient.layer));
// Layers read DATABASE_URL and ENCRYPTION_KEYS lazily. Build them now so a bad value stops startup.
await runtime.context().catch(failWith("invalid configuration"));

if (config.acceptSessionTokens) console.warn("mcp: MCP_DEV_ACCEPT_SESSION_TOKENS is on. Never enable it in production.");

export default makeApp({
  resourceUrl: config.resourceUrl,
  issuer: clerkIssuer(config.clerkPublishableKey)!,
  webOrigin: config.webOrigin,
  runtime,
  authenticate: clerkAuthenticate({
    secretKey: Redacted.value(config.clerkSecretKey),
    publishableKey: config.clerkPublishableKey,
    acceptSessionTokens: config.acceptSessionTokens,
    audience: config.enforceAudience ? config.resourceUrl : undefined,
  }),
});
