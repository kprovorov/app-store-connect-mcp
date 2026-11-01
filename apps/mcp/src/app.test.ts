import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clerkIssuer } from "./config";
import { GOOD_TOKEN, ISSUER, RESOURCE_URL, callerFor, rpc, testApp } from "./testing";

const caller = callerFor("user_alice", [{ id: "org_acme", name: "Acme" }]);
let test: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  test = await testApp({ caller });
});
afterAll(() => test.dispose());

describe("clerkIssuer", () => {
  it("decodes the Frontend API host from a publishable key", () => {
    const key = `pk_test_${Buffer.from("example.clerk.accounts.dev$").toString("base64")}`;
    expect(clerkIssuer(key)).toBe("https://example.clerk.accounts.dev");
  });

  it.each(["sk_test_abc", "pk_test_", `pk_test_${Buffer.from("no-dollar.dev").toString("base64")}`])(
    "rejects %s",
    (key) => expect(clerkIssuer(key)).toBeUndefined(),
  );
});

describe("protected resource metadata", () => {
  it.each(["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"])(
    "%s names the configured resource and the Clerk issuer",
    async (path) => {
      const response = await test.app.request(`http://localhost:8788${path}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        resource: RESOURCE_URL,
        authorization_servers: [ISSUER],
        bearer_methods_supported: ["header"],
        scopes_supported: ["profile", "email"],
      });
    },
  );
});

describe("POST /mcp auth", () => {
  it("answers 401 with a quoted resource_metadata challenge when there is no token", async () => {
    const { response } = await rpc(test.app, "tools/list", {}, null);
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"',
    );
  });

  it("adds error=invalid_token when the token is bad", async () => {
    const { response } = await rpc(test.app, "tools/list", {}, "oat_garbage");
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      'Bearer error="invalid_token", resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"',
    );
  });

  it("answers GET with 405 once authenticated, because the server is stateless", async () => {
    const response = await test.app.request("/mcp", { headers: { authorization: `Bearer ${GOOD_TOKEN}` } });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });
});

describe("MCP over HTTP", () => {
  it("initializes without a session id", async () => {
    const { response, body } = await rpc(test.app, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toBeNull();
    expect(body.result.serverInfo.name).toBe("app-store-connect");
    expect(body.result.capabilities.tools).toBeDefined();
  });

  it("rejects an unknown tool with a JSON-RPC error", async () => {
    const { body } = await rpc(test.app, "tools/call", { name: "nope", arguments: {} });
    expect(body.error.code).toBe(-32602);
  });
});
