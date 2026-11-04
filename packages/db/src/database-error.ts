import { Data } from "effect";
import postgres from "postgres";

/** `code` is a Postgres SQLSTATE or an allowlisted connection/driver error code. */
export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  readonly code: string | undefined;
  readonly message: string;
}> {}

const safeCodes = new Set([
  "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH",
  "ENOTFOUND", "EAI_AGAIN", "EPIPE", "ENETDOWN", "EHOSTDOWN", "EADDRNOTAVAIL",
  "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID", "CERT_REVOKED", "ERR_TLS_CERT_ALTNAME_INVALID", "ERR_TLS_HANDSHAKE_TIMEOUT",
  "ERR_SSL_WRONG_VERSION_NUMBER", "ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION",
  "ERR_SSL_TLSV1_ALERT_UNKNOWN_CA", "ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE", "ERR_SSL_CERTIFICATE_VERIFY_FAILED",
  "CONNECTION_CLOSED", "CONNECTION_DESTROYED", "CONNECTION_ENDED", "CONNECT_TIMEOUT",
  "SASL_SIGNATURE_MISMATCH", "AUTH_TYPE_NOT_IMPLEMENTED", "UNDEFINED_VALUE", "NOT_TAGGED_CALL",
  "MAX_PARAMETERS_EXCEEDED", "UNSAFE_TRANSACTION", "COPY_IN_PROGRESS", "MESSAGE_NOT_SUPPORTED",
]);

const safeNames = new Set(["TypeError", "RangeError", "ReferenceError", "SyntaxError", "AggregateError"]);

// Drizzle wrappers and driver messages can carry SQL params, claims, ciphertext, and URLs.
// Keep only known codes/names, never the original error, message, stack, or cause.
export const toDatabaseError = (error: unknown): DatabaseError => {
  const pending: unknown[] = [error];
  const seen = new Set<object>();
  let name: string | undefined;

  while (pending.length > 0 && seen.size < 32) {
    const current = pending.shift();
    if (typeof current !== "object" || current === null || seen.has(current)) continue;
    seen.add(current);

    const candidate = current as { code?: unknown; name?: unknown; cause?: unknown; errors?: unknown };
    const code = candidate.code;
    const isPostgres = current instanceof postgres.PostgresError || candidate.name === "PostgresError";
    if (typeof code === "string" && (safeCodes.has(code) || (isPostgres && /^[0-9A-Z]{5}$/.test(code)))) {
      return new DatabaseError({ code, message: `Database request failed (${code})` });
    }

    if (name === undefined && typeof candidate.name === "string" && safeNames.has(candidate.name)) {
      name = candidate.name;
    }
    pending.push(candidate.cause);
    if (Array.isArray(candidate.errors)) pending.push(...candidate.errors.slice(0, 32));
  }

  return new DatabaseError({
    code: undefined,
    message: name ? `Database request failed (${name})` : "Database request failed",
  });
};
