import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "./auth";
import { fakeAsc, p256Pem, testApp } from "./testing";

const suffix = Math.random().toString(36).slice(2, 10);
const admin: Session = { userId: `user_admin${suffix}`, orgId: `org_api${suffix}`, orgRole: "org:admin" };
const member: Session = { ...admin, userId: `user_member${suffix}`, orgRole: "org:member" };
const keyId = suffix.toUpperCase().padEnd(10, "K").slice(0, 10);

const asc = fakeAsc({ status: 200, body: { data: [] } });
let apps: Awaited<ReturnType<typeof testApp>>[];
let asAdmin: Awaited<ReturnType<typeof testApp>>["app"];
let asMember: Awaited<ReturnType<typeof testApp>>["app"];
let privateKey: string;

beforeAll(async () => {
  apps = [await testApp({ session: admin, fetch: asc.fetch }), await testApp({ session: member, fetch: asc.fetch })];
  [asAdmin, asMember] = apps.map((test) => test.app) as [typeof asAdmin, typeof asMember];
  privateKey = await p256Pem();
});
afterAll(() => Promise.all(apps.map((test) => test.dispose())));

const create = (app: typeof asAdmin, overrides: Record<string, unknown> = {}) =>
  app.request("/v1/connections", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Main team",
      keyKind: "team",
      issuerId: "57246542-96fe-1a63-e053-0824d011072a",
      keyId,
      privateKey,
      vendorNumber: "85123456",
      ...overrides,
    }),
  });

const listIds = async (app: typeof asAdmin) => {
  const body = (await (await app.request("/v1/connections")).json()) as { connections: Array<{ id: string }> };
  return body.connections.map((connection) => connection.id);
};

describe("connections against the local database", () => {
  let id: string;

  it("creates a verified connection and never returns the key", async () => {
    const response = await create(asAdmin);
    expect(response.status).toBe(201);
    const text = await response.text();
    const { connection } = JSON.parse(text);
    expect(connection).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: "Main team",
      keyKind: "team",
      issuerId: "57246542-96fe-1a63-e053-0824d011072a",
      keyId,
      vendorNumber: "85123456",
      createdAt: expect.any(String),
      lastVerifiedAt: expect.any(String),
    });
    expect(text).not.toContain("PRIVATE KEY");
    expect(text).not.toMatch(/"v1\./);
    id = connection.id;
  });

  it("lists the connection for every member of the org", async () => {
    expect(await listIds(asAdmin)).toEqual([id]);
    expect(await listIds(asMember)).toEqual([id]);
  });

  it("answers 409 when the org already has that key", async () => {
    const response = await create(asAdmin, { name: "Again" });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "conflict" } });
  });

  it("re-verifies a stored key by decrypting it", async () => {
    const response = await asAdmin.request(`/v1/connections/${id}/verify`, { method: "POST" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, connection: { id } });
  });

  it("lets RLS refuse writes from a non-admin with 403", async () => {
    const created = await create(asMember, { keyId: "MEMBER0001" });
    expect(created.status).toBe(403);
    expect(await created.json()).toMatchObject({ error: { code: "forbidden" } });
    const deleted = await asMember.request(`/v1/connections/${id}`, { method: "DELETE" });
    expect(deleted.status).toBe(403);
  });

  it("deletes with 204, then answers 404", async () => {
    expect((await asAdmin.request(`/v1/connections/${id}`, { method: "DELETE" })).status).toBe(204);
    expect(await listIds(asAdmin)).toEqual([]);
    const again = await asAdmin.request(`/v1/connections/${id}`, { method: "DELETE" });
    expect(again.status).toBe(404);
    expect(await again.json()).toMatchObject({ error: { code: "not_found" } });
  });

  it("answers 404 for an id that is not a UUID", async () => {
    expect((await asAdmin.request("/v1/connections/nope/verify", { method: "POST" })).status).toBe(404);
  });
});
