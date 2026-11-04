import { DatabaseError } from "@asc-mcp/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { failureResponse } from "./errors";

afterEach(() => vi.restoreAllMocks());

describe("database failure responses", () => {
  it.each(["ECONNREFUSED", "SELF_SIGNED_CERT_IN_CHAIN", "42501"])("logs %s only on the server", async (code) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const message = `Database request failed (${code})`;
    const response = failureResponse(new DatabaseError({ code, message }));

    expect(log).toHaveBeenCalledExactlyOnceWith("api: DatabaseError", message);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "internal", message: "Something went wrong on our side" },
    });
  });
});
