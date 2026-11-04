import { ConfigProvider, Effect } from "effect";
import { describe, expect, it } from "vitest";
import { McpConfig } from "./config";

const readConfig = (resourceUrl: string) =>
  Effect.gen(function* () {
    return yield* McpConfig;
  }).pipe(
    Effect.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          MCP_RESOURCE_URL: resourceUrl,
          WEB_ORIGIN: "https://app.example.com",
          CLERK_SECRET_KEY: "sk_test_fixture",
          CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from("example.clerk.accounts.dev$").toString("base64")}`,
        }),
      ),
    ),
  );

describe("MCP resource configuration", () => {
  it.each(["https://mcp.example.com", "https://mcp.example.com/"])(
    "preserves %s exactly for metadata and token audience checks",
    async (resourceUrl) => {
      const config = await Effect.runPromise(readConfig(resourceUrl));
      expect(config.resourceUrl).toBe(resourceUrl);
      expect(config.enforceAudience).toBe(true);
    },
  );

  it.each(["", "not-a-url"])("rejects an invalid resource URL: %s", async (resourceUrl) => {
    await expect(Effect.runPromise(readConfig(resourceUrl))).rejects.toThrow();
  });
});
