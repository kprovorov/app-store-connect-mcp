import { decrypt, encrypt, type EncryptedSecret, parseKeyring } from "@asc-mcp/crypto";
import { Effect, ManagedRuntime } from "effect";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ascConnections,
  type ConnectionId,
  connectionSecretAad,
  Database,
  deleteConnection,
  getConnection,
  insertConnection,
  listConnections,
  newConnectionId,
  type NewConnection,
  type OrgClaims,
  type OrgId,
  type RlsClaims,
  touchVerified,
  type UserId,
} from "./index";

const url = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const runtime = ManagedRuntime.make(Database.layer(url));
const owner = postgres(url, { prepare: false, onnotice: () => {} });

const run = <A, E>(effect: Effect.Effect<A, E, Database>) => runtime.runPromise(effect);
const failure = <A, E>(effect: Effect.Effect<A, E, Database>) => runtime.runPromise(Effect.flip(effect));

const suffix = Math.random().toString(36).slice(2, 10);
const orgA = `org_rlsA${suffix}` as OrgId;
const orgB = `org_rlsB${suffix}` as OrgId;
const alice = `user_alice${suffix}` as UserId;
const bob = `user_bob${suffix}` as UserId;

const adminA: OrgClaims = { kind: "org", sub: alice, orgId: orgA, orgRole: "org:admin" };
const memberA: OrgClaims = { kind: "org", sub: bob, orgId: orgA, orgRole: "org:member" };
const adminB: OrgClaims = { kind: "org", sub: bob, orgId: orgB, orgRole: "org:admin" };
const memberOfBoth: RlsClaims = { kind: "member", sub: bob, orgIds: [orgA, orgB] };

const keyId = () => Math.random().toString(36).slice(2, 12).toUpperCase().padEnd(10, "X");
const newConnection = (overrides: Partial<NewConnection> = {}): NewConnection => ({
  id: newConnectionId(),
  name: "Main team",
  key: { kind: "team", issuerId: "57246542-96fe-1a63-e053-0824d011072a" },
  keyId: keyId(),
  encryptedPrivateKey: "v1.aaaa.bbbb" as EncryptedSecret,
  vendorNumber: null,
  ...overrides,
});

const rowExists = async (id: ConnectionId) =>
  (await owner`select 1 from asc_connections where id = ${id}`).length === 1;

let connA: ConnectionId;
let connB: ConnectionId;

beforeAll(async () => {
  connA = (await run(insertConnection(adminA, newConnection()))).id;
  connB = (await run(insertConnection(adminB, newConnection()))).id;
});

afterAll(async () => {
  await owner`delete from asc_connections where org_id in (${orgA}, ${orgB})`;
  await owner.end();
  await runtime.dispose();
});

describe("asc_connections RLS", () => {
  it("lets an org admin insert, and stamps org and creator from the claims", async () => {
    const created = await run(getConnection(adminA, connA));
    expect(created).toMatchObject({ id: connA, orgId: orgA, createdBy: alice, lastVerifiedAt: null });
    expect(created.key).toEqual({ kind: "team", issuerId: "57246542-96fe-1a63-e053-0824d011072a" });
  });

  it("stores individual keys without an issuer", async () => {
    const created = await run(insertConnection(adminA, newConnection({ key: { kind: "individual" } })));
    expect(created.key).toEqual({ kind: "individual" });
  });

  it("refuses inserts from a non-admin member", async () => {
    expect(await failure(insertConnection(memberA, newConnection()))).toMatchObject({
      _tag: "ConnectionForbidden",
    });
  });

  it("lets a member read but not delete or update", async () => {
    expect((await run(listConnections(memberA))).map((c) => c.id)).toContain(connA);
    expect(await failure(deleteConnection(memberA, connA))).toMatchObject({ _tag: "ConnectionNotFound" });
    expect(await failure(touchVerified(memberA, connA))).toMatchObject({ _tag: "ConnectionNotFound" });
    expect(await rowExists(connA)).toBe(true);
  });

  it("hides org A's rows from org B's admin", async () => {
    const visible = await run(listConnections(adminB));
    expect(visible.map((c) => c.id)).toEqual([connB]);
    expect(await failure(getConnection(adminB, connA))).toMatchObject({ _tag: "ConnectionNotFound" });
    expect(await failure(deleteConnection(adminB, connA))).toMatchObject({ _tag: "ConnectionNotFound" });
    expect(await rowExists(connA)).toBe(true);
  });

  it("shows every org's rows to member claims listing both orgs", async () => {
    const ids = (await run(listConnections(memberOfBoth))).map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining([connA, connB]));
    expect(new Set((await run(listConnections(memberOfBoth))).map((c) => c.orgId))).toEqual(new Set([orgA, orgB]));
  });

  it("shows nothing to the authenticated role without claims", async () => {
    const asOwner = await owner`select count(*)::int as n from asc_connections where org_id in (${orgA}, ${orgB})`;
    expect(asOwner[0]?.n).toBeGreaterThanOrEqual(2);
    const asAnonymousUser = await owner.begin(async (tx) => {
      await tx`set local role authenticated`;
      return tx`select count(*)::int as n from asc_connections`;
    });
    expect(asAnonymousUser[0]?.n).toBe(0);
  });

  it("rejects a team key without an issuer at the database", async () => {
    const error = await failure(
      Database.use((db) =>
        db.withClaims(adminA, (tx) =>
          tx.insert(ascConnections).values({
            id: newConnectionId(),
            orgId: orgA,
            name: "broken",
            keyKind: "team",
            issuerId: null,
            keyId: keyId(),
            encryptedPrivateKey: "v1.a.b" as EncryptedSecret,
            createdBy: alice,
          }),
        ),
      ),
    );
    expect(error).toMatchObject({ _tag: "DatabaseError", code: "23514" });
  });

  it("reports a duplicate key ID in the same org as a conflict", async () => {
    const first = newConnection();
    await run(insertConnection(adminA, first));
    expect(await failure(insertConnection(adminA, newConnection({ keyId: first.keyId })))).toMatchObject({
      _tag: "ConnectionKeyConflict",
      keyId: first.keyId,
    });
  });

  it("lets the admin mark a connection verified and delete it", async () => {
    const created = await run(insertConnection(adminA, newConnection()));
    const verified = await run(touchVerified(adminA, created.id));
    expect(verified.lastVerifiedAt).toBeInstanceOf(Date);
    expect(verified.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
    await run(deleteConnection(adminA, created.id));
    expect(await rowExists(created.id)).toBe(false);
  });

  it("binds the stored private key to its row through the AAD", async () => {
    const keyring = await Effect.runPromise(
      parseKeyring(`1:${Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64")}`),
    );
    const id = newConnectionId();
    const secret = await Effect.runPromise(encrypt(keyring, "-----BEGIN PRIVATE KEY-----", connectionSecretAad(orgA, id)));
    await run(insertConnection(adminA, newConnection({ id, encryptedPrivateKey: secret })));
    const stored = await run(getConnection(adminA, id));

    expect(await Effect.runPromise(decrypt(keyring, stored.encryptedPrivateKey, connectionSecretAad(orgA, id)))).toBe(
      "-----BEGIN PRIVATE KEY-----",
    );
    const moved = await Effect.runPromise(
      Effect.flip(decrypt(keyring, stored.encryptedPrivateKey, connectionSecretAad(orgA, connA))),
    );
    expect(moved).toMatchObject({ _tag: "DecryptError", reason: "auth_failed" });
  });
});
