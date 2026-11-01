import { parseCredentials } from "@asc-mcp/asc";
import { Crypto } from "@asc-mcp/crypto";
import { type Connection, connectionSecretAad } from "@asc-mcp/db";
import { Effect } from "effect";

export type ConnectionChoice =
  | { readonly ok: true; readonly connection: Connection }
  | { readonly ok: false; readonly reason: "no_connections" }
  | { readonly ok: false; readonly reason: "ambiguous"; readonly candidates: ReadonlyArray<Connection> }
  | { readonly ok: false; readonly reason: "not_found"; readonly connectionId: string };

export const resolveConnection = (
  connections: ReadonlyArray<Connection>,
  connectionId?: string,
): ConnectionChoice => {
  if (connectionId !== undefined) {
    const connection = connections.find((candidate) => candidate.id === connectionId);
    return connection ? { ok: true, connection } : { ok: false, reason: "not_found", connectionId };
  }
  const [only, ...rest] = connections;
  if (!only) return { ok: false, reason: "no_connections" };
  if (rest.length > 0) return { ok: false, reason: "ambiguous", candidates: connections };
  return { ok: true, connection: only };
};

export const storedCredentials = (connection: Connection) =>
  Effect.gen(function* () {
    const crypto = yield* Crypto;
    const privateKey = yield* crypto.decrypt(
      connection.encryptedPrivateKey,
      connectionSecretAad(connection.orgId, connection.id),
    );
    return yield* Effect.orDie(
      parseCredentials({
        kind: connection.key.kind,
        issuerId: connection.key.kind === "team" ? connection.key.issuerId : null,
        keyId: connection.keyId,
        privateKey,
      }),
    );
  });
