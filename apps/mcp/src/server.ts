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
  readonly assetFetch?: typeof fetch;
}

export const createMcpServer = (deps: ServerDeps) => {
  const server = new Server(
    { name: "app-store-connect", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Tools act on App Store Connect through API keys the user added in the web app. " +
        "Start with list_apps to find app ids. If a tool reports several connections, call list_connections and pass connection_id. " +
        "asc_find_operations searches all Apple API operations; asc_describe_operation returns the arguments schema for one operation. " +
        "Execute catalog operations by ID through asc_read_operation or asc_write_operation. Pass connection_id outside arguments. " +
        "upload_screenshot uses the current asset library. upload_asset transfers bytes to an existing reservation. " +
        "asc_get follows links.next for Apple resource paging. Report chunks require expected_sha256 after the first chunk.",
    },
  );
  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    if (request.params?.cursor !== undefined) throw new McpError(ErrorCode.InvalidParams, "The compact tool catalog has no further pages");
    return { tools: [...toolDefinitions] };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const caller = callerOf(extra.authInfo);
    if (!caller) throw new McpError(ErrorCode.InvalidRequest, "Missing caller");
    const handler = handlers.get(request.params.name);
    if (!handler) throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${request.params.name}`);
    const result = await deps.runtime.runPromise(handler(request.params.arguments ?? {}, { caller, webOrigin: deps.webOrigin, assetFetch: deps.assetFetch }));
    if (Buffer.byteLength(JSON.stringify(result)) > 3.5 * 1024 * 1024) return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: "response_too_large", message: "Use a smaller Apple page or fields selection. MCP responses are limited to 3.5 MiB." }) }] };
    return result;
  });
  return server;
};
