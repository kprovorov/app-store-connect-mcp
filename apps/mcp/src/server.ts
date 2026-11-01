import { type Connection, type Database, type DatabaseError, listConnections } from "@asc-mcp/db";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { Effect, type ManagedRuntime } from "effect";
import { type Caller, callerOf } from "./auth";

export type Services = Database;

export interface ServerDeps {
  readonly runtime: ManagedRuntime.ManagedRuntime<Services, unknown>;
  readonly webOrigin: string;
}

const text = (value: unknown, isError = false): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
  ...(isError ? { isError: true } : {}),
});

const internalError = (failure: DatabaseError) => {
  console.error(`mcp: ${failure._tag}`, failure.message);
  return text({ error: "internal", message: "Something went wrong on our side. Try again." }, true);
};

export const connectionSummary = (connection: Connection, caller: Caller) => ({
  id: connection.id,
  name: connection.name,
  org: { id: connection.orgId, name: caller.orgs.find((org) => org.id === connection.orgId)?.name ?? null },
  keyKind: connection.key.kind,
  keyId: connection.keyId,
});

const listConnectionsTool: Tool = {
  name: "list_connections",
  title: "List App Store Connect connections",
  description:
    "Lists the App Store Connect API keys this user can use, across all of their organizations. " +
    "Returns id, name, org, keyKind, and keyId for each. Pass an id as connection_id to the other tools " +
    "when there is more than one connection.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

const tools: ReadonlyArray<Tool> = [listConnectionsTool];

type Handler = (caller: Caller, deps: ServerDeps) => Effect.Effect<CallToolResult, never, Services>;

const handlers: Record<string, Handler> = {
  [listConnectionsTool.name]: (caller, deps) =>
    listConnections(caller.claims).pipe(
      Effect.map((connections) =>
        text({
          connections: connections.map((connection) => connectionSummary(connection, caller)),
          ...(connections.length === 0 ? { hint: `Add a connection at ${deps.webOrigin}` } : {}),
        }),
      ),
      Effect.catch((failure) => Effect.succeed(internalError(failure))),
    ),
};

/** A fresh server per request: the transport is stateless, so nothing outlives one HTTP call. */
export const createMcpServer = (deps: ServerDeps) => {
  const server = new Server(
    { name: "app-store-connect", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Tools act on App Store Connect through API keys the user added in the web app. " +
        "If a tool reports several connections, call list_connections and pass connection_id.",
    },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...tools] }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const caller = callerOf(extra.authInfo);
    if (!caller) throw new McpError(ErrorCode.InvalidRequest, "Missing caller");
    const handler = handlers[request.params.name];
    if (!handler) throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${request.params.name}`);
    return deps.runtime.runPromise(handler(caller, deps));
  });
  return server;
};
