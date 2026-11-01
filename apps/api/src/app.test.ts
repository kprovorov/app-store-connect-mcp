import { afterEach, describe, expect, it } from "vitest";
import type { Session } from "./auth";
import { type AscReply, WEB_ORIGIN, appleError, fakeAsc, p256Pem, signedOut, testApp } from "./testing";

const admin: Session = { userId: "user_alice", orgId: "org_acme", orgRole: "org:admin" };
const ISSUER = "57246542-96fe-1a63-e053-0824d011072a";

let dispose: (() => Promise<void>) | undefined;
afterEach(() => dispose?.());

const setup = async (session: Session = admin, reply: AscReply = { status: 200, body: { data: [] } }) => {
  const asc = fakeAsc(reply);
  const test = await testApp({ session, fetch: asc.fetch });
  dispose = test.dispose;
  return { app: test.app, asc };
};

const post = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const teamKey = async (overrides: Record<string, unknown> = {}) => ({
  name: "Main team",
  keyKind: "team",
  issuerId: ISSUER,
  keyId: "2X9R4HXF34",
  privateKey: await p256Pem(),
  ...overrides,
});

describe("auth guard", () => {
  it("answers 401 with the contract body when there is no session", async () => {
    const { app } = await setup(signedOut);
    const response = await app.request("/v1/connections");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "unauthenticated", message: expect.any(String) } });
  });

  it("answers 403 org_required when the session has no active organization", async () => {
    const { app } = await setup({ userId: "user_alice", orgId: null, orgRole: null });
    const response = await app.request("/v1/connections", post(await teamKey()));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "org_required" } });
  });
});

describe("POST /v1/connections input", () => {
  it("rejects a malformed key ID with field keyId before calling Apple", async () => {
    const { app, asc } = await setup();
    const response = await app.request("/v1/connections", post(await teamKey({ keyId: "nope" })));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_input", field: "keyId" } });
    expect(asc.urls).toEqual([]);
  });

  it("names the missing field when the body does not match the contract", async () => {
    const { app } = await setup();
    const { name: _, ...withoutName } = await teamKey();
    const response = await app.request("/v1/connections", post(withoutName));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_input", field: "name" } });
  });

  it("rejects an issuer ID on an individual key", async () => {
    const { app } = await setup();
    const response = await app.request("/v1/connections", post(await teamKey({ keyKind: "individual" })));
    expect(await response.json()).toMatchObject({ error: { code: "invalid_input", field: "issuerId" } });
  });

  it("answers 422 invalid_key when Apple rejects the key with 401", async () => {
    const { app, asc } = await setup(admin, {
      status: 401,
      body: appleError(401, "NOT_AUTHORIZED", "Provide a properly configured and signed bearer token"),
    });
    const response = await app.request("/v1/connections", post(await teamKey()));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: {
        code: "verification_failed",
        reason: "invalid_key",
        message: "Provide a properly configured and signed bearer token",
      },
    });
    expect(asc.urls.map((url) => new URL(url).pathname)).toEqual(["/v1/apps"]);
  });
});

describe("CORS", () => {
  it("lets the web origin send Authorization", async () => {
    const { app } = await setup();
    const response = await app.request("/v1/connections", {
      method: "OPTIONS",
      headers: { origin: WEB_ORIGIN, "access-control-request-method": "POST", "access-control-request-headers": "authorization" },
    });
    expect(response.headers.get("access-control-allow-origin")).toBe(WEB_ORIGIN);
    expect(response.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("authorization");
  });

  it("does not allow other origins", async () => {
    const { app } = await setup();
    const response = await app.request("/v1/connections", {
      method: "OPTIONS",
      headers: { origin: "https://evil.example.com", "access-control-request-method": "GET" },
    });
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});
