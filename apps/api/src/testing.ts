import { AscClient } from "@asc-mcp/asc";
import { Crypto, parseKeyring } from "@asc-mcp/crypto";
import { Database } from "@asc-mcp/db";
import { Effect, Layer, ManagedRuntime } from "effect";
import type { MiddlewareHandler } from "hono";
import { makeApp } from "./app";
import type { Session, SessionEnv } from "./auth";

export const WEB_ORIGIN = "http://localhost:3000";
export const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export const p256Pem = async () => {
  const pair = await globalThis.crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const der = Buffer.from(await globalThis.crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64");
  return `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----`;
};

export interface AscReply {
  readonly status: number;
  readonly body: unknown;
}

export const fakeAsc = (reply: AscReply) => {
  const urls: Array<string> = [];
  const fetch = (async (input: string | URL | Request) => {
    urls.push(String(input));
    return Response.json(reply.body, { status: reply.status });
  }) as typeof globalThis.fetch;
  return { urls, fetch };
};

export const appleError = (status: number, code: string, detail: string) => ({
  errors: [{ status: String(status), code, title: code, detail }],
});

const sessionOf =
  (session: Session): MiddlewareHandler<SessionEnv> =>
  async (c, next) => {
    c.set("session", session);
    await next();
  };

export const signedOut: Session = { userId: null, orgId: null, orgRole: null };

/** Tests that never reach the database run without one: postgres.js connects on the first query. */
export const testApp = async (options: { readonly session: Session; readonly fetch: typeof globalThis.fetch }) => {
  const keyring = await Effect.runPromise(parseKeyring(`1:${Buffer.alloc(32, 7).toString("base64")}`));
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      Database.layer(DATABASE_URL),
      Crypto.layer(keyring),
      AscClient.layerWith({ fetch: options.fetch, retryBaseDelay: "1 millis" }),
    ),
  );
  const app = makeApp({ webOrigin: WEB_ORIGIN, session: sessionOf(options.session), runtime });
  return { app, dispose: () => runtime.dispose() };
};
