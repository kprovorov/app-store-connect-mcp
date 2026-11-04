import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { type Authenticate, protectedResourceMetadata, unauthorized } from "./auth";
import { type ServerDeps, createMcpServer } from "./server";
import { isMcpPath, presetPaths, resolveView, type ToolView } from "./tool-views";

export interface McpDeps extends ServerDeps {
  readonly resourceUrl: string;
  readonly issuer: string;
  readonly authenticate: Authenticate;
}

export const makeApp = (deps: McpDeps) => {
  const metadata = protectedResourceMetadata(deps.resourceUrl, deps.issuer);
  const metadataHeaders = { "access-control-allow-origin": "*" };

  const app = new Hono().get("/health", (c) => c.json({ ok: true }));
  for (const path of ["/.well-known/oauth-protected-resource", ...presetPaths.map((preset) => `/.well-known/oauth-protected-resource${preset}`)]) {
    app.get(path, (c) => c.json(metadata, 200, metadataHeaders));
  }
  return app.all("*", async (c) => {
    if (!isMcpPath(c.req.path)) return c.notFound();
    const outcome = await deps.authenticate(c.req.raw);
    if (outcome.kind !== "authenticated") return unauthorized(deps.resourceUrl, outcome.kind);
    // Stateless: no session to resume a stream from, and nothing to delete.
    if (c.req.method !== "POST") {
      return c.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null }, 405, {
        Allow: "POST",
      });
    }
    let view: ToolView;
    try {
      view = resolveView(new URL(c.req.url));
    } catch (error) {
      return c.json({ error: "invalid_view", message: error instanceof Error ? error.message : String(error) }, 400);
    }
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const server = createMcpServer(deps, view);
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw, { authInfo: outcome.authInfo });
    } finally {
      await server.close();
    }
  });
};
