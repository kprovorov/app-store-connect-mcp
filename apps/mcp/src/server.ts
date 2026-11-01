import type { AscClient } from "@asc-mcp/asc";
import type { Crypto } from "@asc-mcp/crypto";
import type { Database } from "@asc-mcp/db";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { ManagedRuntime } from "effect";
import { callerOf } from "./auth";
import { handlers, toolDefinitions } from "./registry";

export type Services = Database | Crypto | AscClient;

export interface ServerDeps {
  readonly runtime: ManagedRuntime.ManagedRuntime<Services, unknown>;
  readonly webOrigin: string;
}

/** A fresh server per request: the transport is stateless, so nothing outlives one HTTP call. */
export const createMcpServer = (deps: ServerDeps) => {
  const server = new Server(
    { name: "app-store-connect", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Tools act on App Store Connect through API keys the user added in the web app. " +
        "Start with list_apps to find app ids. If a tool reports several connections, call list_connections and pass connection_id. " +
        "asc_get reads any API path the named tools do not cover, and follows links.next for paging.",
    },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...toolDefinitions] }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const caller = callerOf(extra.authInfo);
    if (!caller) throw new McpError(ErrorCode.InvalidRequest, "Missing caller");
    const handler = handlers.get(request.params.name);
    if (!handler) throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${request.params.name}`);
    return deps.runtime.runPromise(handler(request.params.arguments ?? {}, { caller, webOrigin: deps.webOrigin }));
  });
  return server;
};
