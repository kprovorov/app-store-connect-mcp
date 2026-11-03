import type { EncryptedSecret } from "@asc-mcp/crypto";
import { Data, Effect } from "effect";
import { asc, eq } from "drizzle-orm";
import type { OrgClaims, RlsClaims } from "./claims";
import { Database, type DatabaseError } from "./database";
import type { ConnectionId, OrgId, UserId } from "./ids";
import { ascConnections } from "./schema";

export type ConnectionKey = { readonly kind: "team"; readonly issuerId: string } | { readonly kind: "individual" };

export interface Connection {
  readonly id: ConnectionId;
  readonly orgId: OrgId;
  readonly name: string;
  readonly key: ConnectionKey;
  readonly keyId: string;
  readonly encryptedPrivateKey: EncryptedSecret;
  readonly vendorNumber: string | null;
  readonly createdBy: UserId;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly lastVerifiedAt: Date | null;
}

export interface NewConnection {
  readonly id: ConnectionId;
  readonly name: string;
  readonly key: ConnectionKey;
  readonly keyId: string;
  readonly encryptedPrivateKey: EncryptedSecret;
  readonly vendorNumber: string | null;
}

export class ConnectionNotFound extends Data.TaggedError("ConnectionNotFound")<{ readonly id: ConnectionId }> {}

/** RLS refused the write: the caller is not an admin of the org. */
export class ConnectionForbidden extends Data.TaggedError("ConnectionForbidden")<{}> {}

export class ConnectionKeyConflict extends Data.TaggedError("ConnectionKeyConflict")<{ readonly keyId: string }> {}

/** AAD for a connection's encrypted private key. Moving the ciphertext to another row breaks decryption. */
export const connectionSecretAad = (orgId: OrgId, id: ConnectionId) => `${orgId}:${id}`;

type Row = typeof ascConnections.$inferSelect;

const toConnection = ({ keyKind, issuerId, ...row }: Row): Connection => ({
  ...row,
  key: keyKind === "team" ? { kind: "team", issuerId: issuerId! } : { kind: "individual" },
});

const single = (id: ConnectionId) => (rows: ReadonlyArray<Row>) =>
  rows[0] ? Effect.succeed(toConnection(rows[0])) : Effect.fail(new ConnectionNotFound({ id }));

const byId = (id: ConnectionId) => eq(ascConnections.id, id);

export const listConnections = (
  claims: RlsClaims,
): Effect.Effect<ReadonlyArray<Connection>, DatabaseError, Database> =>
  Database.use((db) =>
    db.withClaims(claims, (tx) => tx.select().from(ascConnections).orderBy(asc(ascConnections.createdAt))),
  ).pipe(Effect.map((rows) => rows.map(toConnection)));

export const getConnection = (
  claims: RlsClaims,
  id: ConnectionId,
): Effect.Effect<Connection, ConnectionNotFound | DatabaseError, Database> =>
  Database.use((db) => db.withClaims(claims, (tx) => tx.select().from(ascConnections).where(byId(id)))).pipe(
    Effect.flatMap(single(id)),
  );

export const insertConnection = (
  claims: OrgClaims,
  input: NewConnection,
): Effect.Effect<Connection, ConnectionForbidden | ConnectionKeyConflict | DatabaseError, Database> =>
  Database.use((db) =>
    db.withClaims(claims, (tx) =>
      tx
        .insert(ascConnections)
        .values({
          id: input.id,
          orgId: claims.orgId,
          name: input.name,
          keyKind: input.key.kind,
          issuerId: input.key.kind === "team" ? input.key.issuerId : null,
          keyId: input.keyId,
          encryptedPrivateKey: input.encryptedPrivateKey,
          vendorNumber: input.vendorNumber,
          createdBy: claims.sub,
        })
        .returning(),
    ),
  ).pipe(
    Effect.mapError((error) =>
      error.code === "42501"
        ? new ConnectionForbidden()
        : error.code === "23505"
          ? new ConnectionKeyConflict({ keyId: input.keyId })
          : error,
    ),
    Effect.flatMap(([row]) => (row ? Effect.succeed(toConnection(row)) : Effect.die("insert returned no row"))),
  );

export const deleteConnection = (
  claims: RlsClaims,
  id: ConnectionId,
): Effect.Effect<void, ConnectionNotFound | DatabaseError, Database> =>
  Database.use((db) => db.withClaims(claims, (tx) => tx.delete(ascConnections).where(byId(id)).returning())).pipe(
    Effect.flatMap(single(id)),
    Effect.asVoid,
  );

export const touchVerified = (
  claims: RlsClaims,
  id: ConnectionId,
): Effect.Effect<Connection, ConnectionNotFound | DatabaseError, Database> =>
  Database.use((db) =>
    db.withClaims(claims, (tx) =>
      tx.update(ascConnections).set({ lastVerifiedAt: new Date() }).where(byId(id)).returning(),
    ),
  ).pipe(Effect.flatMap(single(id)));
