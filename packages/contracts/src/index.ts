import { Schema } from "effect";

/** The HTTP contract between `web` and `api`. Dates travel as ISO 8601 strings. */

export const KeyKind = Schema.Literals(["team", "individual"]);
export type KeyKind = typeof KeyKind.Type;

export const Connection = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  keyKind: KeyKind,
  issuerId: Schema.NullOr(Schema.String),
  keyId: Schema.String,
  vendorNumber: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  lastVerifiedAt: Schema.NullOr(Schema.String),
});
export type Connection = typeof Connection.Type;

/** `issuerId` is required for team keys and must be absent for individual keys. */
export const CreateConnectionRequest = Schema.Struct({
  name: Schema.String,
  keyKind: KeyKind,
  issuerId: Schema.optionalKey(Schema.String),
  keyId: Schema.String,
  privateKey: Schema.String,
  vendorNumber: Schema.optionalKey(Schema.String),
});
export type CreateConnectionRequest = typeof CreateConnectionRequest.Type;

export const ListConnectionsResponse = Schema.Struct({ connections: Schema.Array(Connection) });
export type ListConnectionsResponse = typeof ListConnectionsResponse.Type;

export const ConnectionResponse = Schema.Struct({ connection: Connection });
export type ConnectionResponse = typeof ConnectionResponse.Type;

export const VerifyFailureReason = Schema.Literals(["invalid_key", "forbidden", "network"]);
export type VerifyFailureReason = typeof VerifyFailureReason.Type;

export const VerifyConnectionResponse = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), connection: Connection }),
  Schema.Struct({ ok: Schema.Literal(false), reason: VerifyFailureReason, detail: Schema.String }),
]);
export type VerifyConnectionResponse = typeof VerifyConnectionResponse.Type;

export const ApiErrorCode = Schema.Literals([
  "unauthenticated",
  "org_required",
  "forbidden",
  "invalid_input",
  "verification_failed",
  "conflict",
  "not_found",
  "internal",
]);
export type ApiErrorCode = typeof ApiErrorCode.Type;

/** Every non-2xx response from `api` has this body. */
export const ApiError = Schema.Struct({
  error: Schema.Struct({
    code: ApiErrorCode,
    message: Schema.String,
    field: Schema.optionalKey(Schema.String),
    reason: Schema.optionalKey(VerifyFailureReason),
  }),
});
export type ApiError = typeof ApiError.Type;

/**
 * Routes, relative to the api origin. Every route needs `Authorization: Bearer <Clerk session token>`
 * from a session with an active organization. Writes need the `org:admin` role.
 *
 * GET    /v1/connections              -> 200 ListConnectionsResponse
 * POST   /v1/connections              -> 201 ConnectionResponse (body CreateConnectionRequest; the key is verified against ASC first)
 * POST   /v1/connections/:id/verify   -> 200 VerifyConnectionResponse
 * DELETE /v1/connections/:id          -> 204
 */
export const routes = {
  connections: "/v1/connections",
  connection: (id: string) => `/v1/connections/${encodeURIComponent(id)}`,
  verifyConnection: (id: string) => `/v1/connections/${encodeURIComponent(id)}/verify`,
} as const;
