import { DrizzleQueryError } from "drizzle-orm/errors";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { toDatabaseError } from "./database-error";

const secret = "postgresql://postgres:private-password@private-host/postgres";
const wrapped = (cause: Error) => new DrizzleQueryError("select secret from private_table", [secret], cause);

describe("database diagnostics", () => {
  it.each([
    "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "ECONNRESET",
    "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "CERT_HAS_EXPIRED",
    "ERR_TLS_CERT_ALTNAME_INVALID", "CONNECT_TIMEOUT", "CONNECTION_CLOSED", "SASL_SIGNATURE_MISMATCH",
  ])("keeps %s through Drizzle wrappers without copying secrets", (code) => {
    const cause = Object.assign(new Error(secret), { code, address: "private-host", query: secret, params: [secret] });
    const error = toDatabaseError(wrapped(cause));
    expect(error.code).toBe(code);
    expect(error.message).toBe(`Database request failed (${code})`);
    expect(error.cause).toBeUndefined();
    expect(error.stack).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain(secret);
  });

  it.each(["42501", "23505", "23514", "28P01"])("preserves SQLSTATE %s for domain error mapping", (code) => {
    const cause = Reflect.construct(postgres.PostgresError, [{ message: secret, code, detail: secret }]);
    const error = toDatabaseError(wrapped(cause));
    expect(error.code).toBe(code);
    expect(error.message).toBe(`Database request failed (${code})`);
    expect(JSON.stringify(error)).not.toContain(secret);
  });

  it("recognizes a Postgres error from another module instance", () => {
    const cause = { name: "PostgresError", code: "42501", message: secret, detail: secret };
    expect(toDatabaseError({ cause }).code).toBe("42501");
  });

  it("finds a connection code inside an AggregateError", () => {
    const cause = new AggregateError([new Error(secret), Object.assign(new Error(secret), { code: "ENETUNREACH" })]);
    expect(toDatabaseError(wrapped(cause)).message).toBe("Database request failed (ENETUNREACH)");
  });

  it("identifies runtime exceptions without copying their messages", () => {
    expect(toDatabaseError(wrapped(new TypeError(secret)))).toMatchObject({
      code: undefined,
      message: "Database request failed (TypeError)",
    });
  });

  it("prefers a cause's known code over a wrapper's runtime type", () => {
    const cause = Object.assign(new Error(secret), { code: "ECONNRESET" });
    expect(toDatabaseError(new TypeError(secret, { cause })).code).toBe("ECONNRESET");
  });

  it.each([secret, "ERR_" + secret, "A".repeat(500), 123])("drops unrecognized error codes and names (%s)", (code) => {
    expect(toDatabaseError({ code, name: secret, message: secret })).toMatchObject({
      code: undefined,
      message: "Database request failed",
    });
  });

  it.each([null, undefined, secret, 123, new Error(secret)])("handles unknown failures without exposing them (%s)", (cause) => {
    expect(toDatabaseError(cause)).toMatchObject({ code: undefined, message: "Database request failed" });
  });

  it("terminates on cycles while still checking aggregate children", () => {
    const cause = new AggregateError([Object.assign(new Error(secret), { code: "ECONNREFUSED" })]);
    cause.cause = cause;
    expect(toDatabaseError(cause).code).toBe("ECONNREFUSED");
    const cycle = new Error(secret);
    cycle.cause = cycle;
    expect(toDatabaseError(cycle).message).toBe("Database request failed");
  });

  it("bounds traversal of a very deep cause chain", () => {
    let cause: unknown = Object.assign(new Error(secret), { code: "ECONNREFUSED" });
    for (let depth = 0; depth < 100; depth++) cause = { cause, message: secret };
    expect(toDatabaseError(cause).message).toBe("Database request failed");
  });
});
