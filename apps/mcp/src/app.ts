import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { type Authenticate, protectedResourceMetadata, unauthorized } from "./auth";
import { type ServerDeps, createMcpServer } from "./server";

export interface McpDeps extends ServerDeps {
  readonly resourceUrl: string;
  readonly issuer: string;
  readonly authenticate: Authenticate;
}

export const makeApp = (deps: McpDeps) => {
  const metadata = protectedResourceMetadata(deps.resourceUrl, deps.issuer);
  const metadataHeaders = { "access-control-allow-origin": "*" };

  return (
    new Hono()
      .get("/health", (c) => c.json({ ok: true }))
      .get("/.well-known/oauth-protected-resource", (c) => c.json(metadata, 200, metadataHeaders))
      .all("/", async (c) => {
        const outcome = await deps.authenticate(c.req.raw);
        if (outcome.kind !== "authenticated") return unauthorized(deps.resourceUrl, outcome.kind);
        // Stateless: no session to resume a stream from, and nothing to delete.
        if (c.req.method !== "POST") {
          return c.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null }, 405, {
            Allow: "POST",
          });
        }
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
        const server = createMcpServer(deps);
        await server.connect(transport);
        try {
          return await transport.handleRequest(c.req.raw, { authInfo: outcome.authInfo });
        } finally {
          await server.close();
        }
      })
  );
};
