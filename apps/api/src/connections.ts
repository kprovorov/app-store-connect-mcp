import { type AscClient, type AscCredentials, parseCredentials, verifyCredentials } from "@asc-mcp/asc";
import {
  type Connection as ConnectionDto,
  CreateConnectionRequest,
  type VerifyConnectionResponse,
  type VerifyFailureReason,
} from "@asc-mcp/contracts";
import { Crypto } from "@asc-mcp/crypto";
import {
  type Connection,
  ConnectionForbidden,
  ConnectionId,
  ConnectionNotFound,
  type Database,
  type OrgClaims,
  connectionSecretAad,
  deleteConnection,
  getConnection,
  insertConnection,
  newConnectionId,
  touchVerified,
} from "@asc-mcp/db";
import { Data, Effect, Schema, type SchemaIssue } from "effect";

export class InvalidInput extends Data.TaggedError("InvalidInput")<{
  readonly message: string;
  readonly field?: string;
}> {}

export class VerificationFailed extends Data.TaggedError("VerificationFailed")<{
  readonly reason: VerifyFailureReason;
  readonly detail: string;
}> {}

export type Services = Database | Crypto | AscClient;

export const toDto = (connection: Connection): ConnectionDto => ({
  id: connection.id,
  name: connection.name,
  keyKind: connection.key.kind,
  issuerId: connection.key.kind === "team" ? connection.key.issuerId : null,
  keyId: connection.keyId,
  vendorNumber: connection.vendorNumber,
  createdAt: connection.createdAt.toISOString(),
  lastVerifiedAt: connection.lastVerifiedAt?.toISOString() ?? null,
});

const issueField = (issue: SchemaIssue.Issue): string | undefined => {
  const first = issue._tag === "Composite" ? issue.issues[0] : issue;
  return first?._tag === "Pointer" && first.path.length > 0 ? String(first.path[0]) : undefined;
};

const decodeCreateRequest = (body: unknown) =>
  Schema.decodeUnknownEffect(CreateConnectionRequest)(body, { onExcessProperty: "error" }).pipe(
    Effect.mapError((error) => {
      const field = issueField(error.issue);
      return new InvalidInput({ message: error.message, ...(field ? { field } : {}) });
    }),
  );

export const parseConnectionId = (raw: string) =>
  Effect.mapError(
    Schema.decodeUnknownEffect(ConnectionId)(raw),
    () => new ConnectionNotFound({ id: raw as ConnectionId }),
  );

const asForbidden = <A, E, R>(effect: Effect.Effect<A, E | ConnectionNotFound, R>) =>
  Effect.catchTag(effect, "ConnectionNotFound", () => Effect.fail(new ConnectionForbidden()));

const storedCredentials = (connection: Connection) =>
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

export const createConnection = (claims: OrgClaims, body: unknown) =>
  Effect.gen(function* () {
    const input = yield* decodeCreateRequest(body);
    const name = input.name.trim();
    if (!name) return yield* new InvalidInput({ field: "name", message: "Name is required" });
    if (input.keyKind === "individual" && input.issuerId !== undefined) {
      return yield* new InvalidInput({ field: "issuerId", message: "Individual keys have no issuer ID" });
    }
    const credentials: AscCredentials = yield* parseCredentials({
      kind: input.keyKind,
      issuerId: input.issuerId,
      keyId: input.keyId,
      privateKey: input.privateKey,
    });
    const verified = yield* verifyCredentials(credentials);
    if (!verified.ok) return yield* new VerificationFailed({ reason: verified.reason, detail: verified.detail });

    const id = newConnectionId();
    const crypto = yield* Crypto;
    const encryptedPrivateKey = yield* crypto.encrypt(credentials.privateKeyPem, connectionSecretAad(claims.orgId, id));
    yield* insertConnection(claims, {
      id,
      name,
      key: credentials.kind === "team" ? { kind: "team", issuerId: credentials.issuerId } : { kind: "individual" },
      keyId: credentials.keyId,
      encryptedPrivateKey,
      vendorNumber: input.vendorNumber?.trim() || null,
    });
    return yield* touchVerified(claims, id);
  });

export const verifyConnection = (claims: OrgClaims, id: ConnectionId) =>
  Effect.gen(function* () {
    const connection = yield* getConnection(claims, id);
    const result = yield* verifyCredentials(yield* storedCredentials(connection));
    if (!result.ok) return result satisfies VerifyConnectionResponse;
    const updated = yield* asForbidden(touchVerified(claims, id));
    return { ok: true, connection: toDto(updated) } satisfies VerifyConnectionResponse;
  });

export const removeConnection = (claims: OrgClaims, id: ConnectionId) =>
  Effect.andThen(getConnection(claims, id), asForbidden(deleteConnection(claims, id)));
