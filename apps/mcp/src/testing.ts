import { AscClient } from "@asc-mcp/asc";
import { Crypto, parseKeyring } from "@asc-mcp/crypto";
import { Database, type OrgId, type UserId } from "@asc-mcp/db";
import { Effect, Layer, ManagedRuntime } from "effect";
import { makeApp } from "./app";
import { type Authenticate, type Caller, bearerToken } from "./auth";

export const RESOURCE_URL = "https://mcp.example.com";
export const ISSUER = "https://example.clerk.accounts.dev";
export const WEB_ORIGIN = "https://app.example.com";
export const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
export const GOOD_TOKEN = "oat_good";

export const callerFor = (userId: string, orgs: ReadonlyArray<{ id: string; name: string }>): Caller => ({
  claims: { kind: "member", sub: userId as UserId, orgIds: orgs.map((org) => org.id as OrgId) },
  orgs: orgs.map((org) => ({ id: org.id as OrgId, name: org.name })),
});

export const fakeAuthenticate =
  (caller: Caller): Authenticate =>
  async (request) => {
    const token = bearerToken(request);
    if (!token) return { kind: "missing" };
    if (token !== GOOD_TOKEN) return { kind: "invalid" };
    return { kind: "authenticated", authInfo: { token, clientId: "test-client", scopes: [], extra: { caller } } };
  };

export const testKeyring = () => Effect.runPromise(parseKeyring(`1:${Buffer.alloc(32, 9).toString("base64")}`));

/** postgres.js connects on the first query, so tests that skip the DB need none. */
export const testApp = async (options: { readonly caller: Caller; readonly fetch?: typeof globalThis.fetch; readonly assetFetch?: typeof globalThis.fetch }) => {
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      Database.layer(DATABASE_URL),
      Crypto.layer(await testKeyring()),
      AscClient.layerWith({ fetch: options.fetch ?? globalThis.fetch, retryBaseDelay: "1 millis" }),
    ),
  );
  const app = makeApp({
    resourceUrl: RESOURCE_URL,
    issuer: ISSUER,
    webOrigin: WEB_ORIGIN,
    runtime,
    authenticate: fakeAuthenticate(options.caller),
    assetFetch: options.assetFetch,
  });
  return { app, runtime, dispose: () => runtime.dispose() };
};

let nextId = 1;

export const rpc = async (
  app: { request: (path: string, init: RequestInit) => Response | Promise<Response> },
  method: string,
  params: Record<string, unknown> = {},
  token: string | null = GOOD_TOKEN,
) => {
  const response = await app.request("/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });
  return { response, body: response.status === 200 ? ((await response.json()) as any) : undefined };
};
