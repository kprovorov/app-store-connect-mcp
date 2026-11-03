import type { InvalidCredentials } from "@asc-mcp/asc";
import { ApiError } from "@asc-mcp/contracts";
import type { DecryptError } from "@asc-mcp/crypto";
import type { ConnectionForbidden, ConnectionKeyConflict, ConnectionNotFound, DatabaseError } from "@asc-mcp/db";
import { Schema } from "effect";
import type { InvalidInput, VerificationFailed } from "./connections";

export type ApiFailure =
  | InvalidInput
  | InvalidCredentials
  | VerificationFailed
  | ConnectionForbidden
  | ConnectionKeyConflict
  | ConnectionNotFound
  | DatabaseError
  | DecryptError;

type ErrorBody = ApiError["error"];

const encodeApiError = Schema.encodeSync(ApiError);

export const errorResponse = (status: number, error: ErrorBody) =>
  Response.json(encodeApiError({ error }), { status });

const internal = (failure: DatabaseError | DecryptError): [number, ErrorBody] => {
  console.error(`api: ${failure._tag}`, failure.message);
  return [500, { code: "internal", message: "Something went wrong on our side" }];
};

const requestField = { kind: "keyKind", issuerId: "issuerId", keyId: "keyId", privateKey: "privateKey" } as const;

const table: { [Tag in ApiFailure["_tag"]]: (failure: Extract<ApiFailure, { _tag: Tag }>) => [number, ErrorBody] } = {
  InvalidInput: (e) => [400, { code: "invalid_input", message: e.message, ...(e.field ? { field: e.field } : {}) }],
  InvalidCredentials: (e) => [400, { code: "invalid_input", message: e.message, field: requestField[e.field] }],
  VerificationFailed: (e) => [422, { code: "verification_failed", message: e.detail, reason: e.reason }],
  ConnectionForbidden: () => [403, { code: "forbidden", message: "Only organization admins can change connections" }],
  ConnectionKeyConflict: (e) => [
    409,
    { code: "conflict", message: `This organization already has a connection for key ${e.keyId}` },
  ],
  ConnectionNotFound: () => [404, { code: "not_found", message: "Connection not found" }],
  DatabaseError: internal,
  DecryptError: internal,
};

export const failureResponse = (failure: ApiFailure) => {
  const [status, body] = (table[failure._tag] as (failure: ApiFailure) => [number, ErrorBody])(failure);
  return errorResponse(status, body);
};
