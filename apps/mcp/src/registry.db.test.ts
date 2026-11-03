import { parseCredentials } from "@asc-mcp/asc";
import { Crypto } from "@asc-mcp/crypto";
import {
  type ConnectionId,
  type OrgClaims,
  type OrgId,
  type UserId,
  connectionSecretAad,
  deleteConnection,
  insertConnection,
  newConnectionId,
} from "@asc-mcp/db";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WEB_ORIGIN, callerFor, rpc, testApp } from "./testing";

const suffix = Math.random().toString(36).slice(2, 10);
const user = `user_mcp${suffix}`;
const orgA = { id: `org_mcpA${suffix}`, name: "Acme" };
const orgB = { id: `org_mcpB${suffix}`, name: "Beta Corp" };
const emptyOrg = { id: `org_mcpEmpty${suffix}`, name: "Empty" };

type Call = { url: URL; authorization: string; method: string };
const calls: Array<Call> = [];
let reply: { status: number; body: unknown; headers?: Record<string, string> } = { status: 200, body: {} };
const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  calls.push({
    url: new URL(String(input)),
    authorization: new Headers(init?.headers).get("authorization") ?? "",
    method: init?.method ?? "GET",
  });
  return new Response(reply.status === 204 ? null : JSON.stringify(reply.body), {
    status: reply.status,
    headers: { "content-type": "application/json", ...reply.headers },
  });
}) as typeof globalThis.fetch;

const p256Pem = async () => {
  const pair = await globalThis.crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const der = Buffer.from(await globalThis.crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64");
  return `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----`;
};

const jwtPayload = (authorization: string) =>
  JSON.parse(Buffer.from(authorization.replace("Bearer ", "").split(".")[1]!, "base64url").toString("utf8"));

let oneOrg: Awaited<ReturnType<typeof testApp>>;
let twoOrgs: Awaited<ReturnType<typeof testApp>>;
let noConnections: Awaited<ReturnType<typeof testApp>>;
let connectionA: ConnectionId;
let connectionB: ConnectionId;

const adminOf = (org: { id: string }): OrgClaims => ({
  kind: "org",
  sub: user as UserId,
  orgId: org.id as OrgId,
  orgRole: "org:admin",
});

const addConnection = async (org: { id: string }, keyId: string) => {
  const admin = adminOf(org);
  const id = newConnectionId();
  const pem = await p256Pem();
  await oneOrg.runtime.runPromise(
    Effect.gen(function* () {
      const { privateKeyPem } = yield* parseCredentials({
        kind: "team",
        issuerId: "57246542-96fe-1a63-e053-0824d011072a",
        keyId,
        privateKey: pem,
      });
      const encryptedPrivateKey = yield* Crypto.use((crypto) =>
        crypto.encrypt(privateKeyPem, connectionSecretAad(admin.orgId, id)),
      );
      yield* insertConnection(admin, {
        id,
        name: `${keyId} key`,
        key: { kind: "team", issuerId: "57246542-96fe-1a63-e053-0824d011072a" },
        keyId,
        encryptedPrivateKey,
        vendorNumber: null,
      });
    }),
  );
  return id;
};

beforeAll(async () => {
  oneOrg = await testApp({ caller: callerFor(user, [orgA]), fetch });
  twoOrgs = await testApp({ caller: callerFor(user, [orgA, orgB]), fetch });
  noConnections = await testApp({ caller: callerFor(user, [emptyOrg]), fetch });
  connectionA = await addConnection(orgA, `A${suffix.toUpperCase()}`.padEnd(10, "0").slice(0, 10));
  connectionB = await addConnection(orgB, `B${suffix.toUpperCase()}`.padEnd(10, "0").slice(0, 10));
});
afterAll(async () => {
  await oneOrg.runtime.runPromise(
    Effect.all([deleteConnection(adminOf(orgA), connectionA), deleteConnection(adminOf(orgB), connectionB)]),
  );
  await Promise.all([oneOrg, twoOrgs, noConnections].map((test) => test.dispose()));
});

const callTool = async (test: typeof oneOrg, name: string, args: Record<string, unknown> = {}) => {
  calls.length = 0;
  const { body } = await rpc(test.app, "tools/call", { name, arguments: args });
  const result = body.result as { content: Array<{ text: string }>; isError?: boolean };
  return { isError: result.isError ?? false, value: JSON.parse(result.content[0]!.text) };
};

describe("tools/call over HTTP", () => {
  it("list_connections shows the caller's connections without secrets", async () => {
    const { isError, value } = await callTool(twoOrgs, "list_connections");
    expect(isError).toBe(false);
    expect(value.connections).toEqual([
      { id: connectionA, name: expect.any(String), org: orgA, keyKind: "team", keyId: expect.any(String) },
      { id: connectionB, name: expect.any(String), org: orgB, keyKind: "team", keyId: expect.any(String) },
    ]);
    expect(JSON.stringify(value)).not.toContain("PRIVATE KEY");
  });

  it("list_apps calls Apple with the stored key and returns compact JSON:API plus the rate limit", async () => {
    reply = {
      status: 200,
      body: {
        data: [{ type: "apps", id: "1", attributes: { name: "Demo", bundleId: "com.example.demo" }, links: { self: "x" } }],
        links: { self: "x" },
        meta: { paging: { total: 1, limit: 50 } },
      },
      headers: { "x-rate-limit": "user-hour-lim:3600;user-hour-rem:3599;" },
    };
    const { isError, value } = await callTool(oneOrg, "list_apps", { bundle_id: "com.example.demo" });
    expect(isError).toBe(false);
    expect(value).toEqual({
      data: [{ type: "apps", id: "1", attributes: { name: "Demo", bundleId: "com.example.demo" } }],
      meta: { paging: { total: 1, limit: 50 } },
      rateLimit: { limit: 3600, remaining: 3599 },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.pathname).toBe("/v1/apps");
    expect(calls[0]!.url.searchParams.get("filter[bundleId]")).toBe("com.example.demo");
    expect(jwtPayload(calls[0]!.authorization)).toMatchObject({ aud: "appstoreconnect-v1", iss: "57246542-96fe-1a63-e053-0824d011072a" });
  });

  it("asc_get signs a token scoped to exactly that GET", async () => {
    reply = { status: 200, body: { data: { type: "appInfos", id: "9" } } };
    await callTool(oneOrg, "asc_get", { path: "/v1/apps/1/appInfos", query: { include: "app", limit: "5" } });
    expect(jwtPayload(calls[0]!.authorization).scope).toEqual(["GET /v1/apps/1/appInfos?include=app"]);
  });

  it("returns Apple's errors so the agent can correct itself", async () => {
    reply = {
      status: 404,
      body: { errors: [{ status: "404", code: "NOT_FOUND", title: "Not found", detail: "There is no app with id 'x'" }] },
    };
    const { isError, value } = await callTool(oneOrg, "get_app", { app_id: "x" });
    expect(isError).toBe(true);
    expect(value).toEqual({
      error: "app_store_connect",
      status: 404,
      errors: [{ status: "404", code: "NOT_FOUND", title: "Not found", detail: "There is no app with id 'x'" }],
    });
  });

  it("asks for connection_id when the caller has several, then uses the one named", async () => {
    const ambiguous = await callTool(twoOrgs, "list_apps");
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.value.error).toBe("ambiguous_connection");
    expect(ambiguous.value.connections.map((c: { id: string; org: { name: string } }) => [c.id, c.org.name])).toEqual([
      [connectionA, "Acme"],
      [connectionB, "Beta Corp"],
    ]);
    expect(calls).toHaveLength(0);

    reply = { status: 200, body: { data: [] } };
    const chosen = await callTool(twoOrgs, "list_apps", { connection_id: connectionB });
    expect(chosen.isError).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("tells the agent where to add a key when the caller has none", async () => {
    const { isError, value } = await callTool(noConnections, "list_apps");
    expect(isError).toBe(true);
    expect(value).toEqual({ error: "no_connections", message: expect.stringContaining(WEB_ORIGIN) });
  });

  it("reports bad arguments without calling Apple", async () => {
    const { isError, value } = await callTool(oneOrg, "list_builds", {});
    expect(isError).toBe(true);
    expect(value.error).toBe("invalid_arguments");
    expect(calls).toHaveLength(0);
  });

  it("answers a 204 write with ok", async () => {
    reply = { status: 204, body: null };
    const { isError, value } = await callTool(oneOrg, "add_testers_to_group", { group_id: "g", tester_ids: ["t"] });
    expect({ isError, value }).toEqual({ isError: false, value: { ok: true, status: 204 } });
    expect(calls[0]!.method).toBe("POST");
  });
});
