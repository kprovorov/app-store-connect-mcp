import type { AscClient } from "@asc-mcp/asc";
import type { Crypto } from "@asc-mcp/crypto";
import type { Database } from "@asc-mcp/db";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { ManagedRuntime } from "effect";
import { callerOf } from "./auth";
import { discover, execution, listTools, type ToolView } from "./tool-views";

export type Services = Database | Crypto | AscClient;

export interface ServerDeps {
  readonly runtime: ManagedRuntime.ManagedRuntime<Services, unknown>;
  readonly webOrigin: string;
  readonly assetFetch?: typeof fetch;
}

export const createMcpServer = (deps: ServerDeps, view: ToolView) => {
  const server = new Server(
    { name: "app-store-connect", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Tools act on App Store Connect through API keys the user added in the web app. " +
        (view.kind === "compact"
          ? "Use discover to search tools or get an exact argumentsSchema. Use execute with tool, arguments, and optional outer connection_id. Start by discovering list_apps. Discover list_connections when several connections are available. "
          : "This URL selects direct tools. Call only the advertised tool names and follow tools/list nextCursor for more definitions. ") +
        (view.readOnly ? "Read-only mode is enforced. Writes and uploads are unavailable. " : "") +
        "Report chunks require expected_sha256 after the first chunk. API key roles still determine which Apple operations succeed.",
    },
  );
  server.setRequestHandler(ListToolsRequestSchema, async (request) => listTools(view, request.params?.cursor));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const caller = callerOf(extra.authInfo);
    if (!caller) throw new McpError(ErrorCode.InvalidRequest, "Missing caller");
    const context = { caller, webOrigin: deps.webOrigin, assetFetch: deps.assetFetch };
    const args = request.params.arguments ?? {};
    const result = await (async () => {
      if (view.kind === "compact") {
        if (!["discover", "execute"].includes(request.params.name)) throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${request.params.name}`);
        let invocation: ReturnType<typeof execution>;
        try {
          if (request.params.name === "discover") {
            return { content: [{ type: "text" as const, text: JSON.stringify(discover(view, args)) }] };
          }
          invocation = execution(view, args);
        } catch (error) {
          return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: "invalid_arguments", message: error instanceof Error ? error.message : String(error) }) }] };
        }
        return deps.runtime.runPromise(invocation.entry.handler(invocation.arguments, context));
      }
      const entry = view.entries.get(request.params.name);
      if (!entry) throw new McpError(ErrorCode.InvalidParams, `Tool is unavailable in this view: ${request.params.name}`);
      return deps.runtime.runPromise(entry.handler(args, context));
    })();
    if (Buffer.byteLength(JSON.stringify(result)) > 3.5 * 1024 * 1024) return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: "response_too_large", message: "Use a smaller Apple page or fields selection. MCP responses are limited to 3.5 MiB." }) }] };
    return result;
  });
  return server;
};
