import {
  AscClient,
  type AscApiError,
  type AscAuthError,
  type AscInvalidPath,
  type AscNetworkError,
  type AscRateLimited,
  type AscResponse,
  type RateLimit,
} from "@asc-mcp/asc";
import type { DecryptError } from "@asc-mcp/crypto";
import { type Connection, type DatabaseError, listConnections } from "@asc-mcp/db";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { Data, Effect, Schema } from "effect";
import type { Caller } from "./auth";
import { type ConnectionChoice, resolveConnection, storedCredentials } from "./connections";
import type { Services } from "./server";
import { type AscTool, ascTools } from "./tools";

export class InvalidArguments extends Data.TaggedError("InvalidArguments")<{ readonly message: string }> {}

export class ConnectionUnavailable extends Data.TaggedError("ConnectionUnavailable")<{
  readonly choice: Exclude<ConnectionChoice, { ok: true }>;
}> {}

type ToolFailure =
  | InvalidArguments
  | ConnectionUnavailable
  | AscApiError
  | AscRateLimited
  | AscNetworkError
  | AscInvalidPath
  | AscAuthError
  | DatabaseError
  | DecryptError;

export interface CallContext {
  readonly caller: Caller;
  readonly webOrigin: string;
}

const text = (value: unknown): CallToolResult => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
const errorText = (value: unknown): CallToolResult => ({ ...text(value), isError: true });

export const connectionSummary = (connection: Connection, caller: Caller) => ({
  id: connection.id,
  name: connection.name,
  org: { id: connection.orgId, name: caller.orgs.find((org) => org.id === connection.orgId)?.name ?? null },
  keyKind: connection.key.kind,
  keyId: connection.keyId,
});

const rateLimitOf = (rateLimit: RateLimit | undefined) => (rateLimit ? { rateLimit } : {});

const internal = (failure: DatabaseError | DecryptError) => {
  console.error(`mcp: ${failure._tag}`, failure.message);
  return errorText({ error: "internal", message: "Something went wrong on our side. Try again." });
};

const connectionMessage = (choice: ConnectionUnavailable["choice"], { caller, webOrigin }: CallContext) => {
  switch (choice.reason) {
    case "no_connections":
      return {
        error: "no_connections",
        message: `None of your organizations has an App Store Connect API key yet. Add one at ${webOrigin}, then retry.`,
      };
    case "ambiguous":
      return {
        error: "ambiguous_connection",
        message: "You can use several App Store Connect connections. Retry with connection_id set to one of these ids.",
        connections: choice.candidates.map((connection) => connectionSummary(connection, caller)),
      };
    case "not_found":
      return {
        error: "connection_not_found",
        message: `No connection ${choice.connectionId} is visible to you. Call list_connections for valid ids.`,
      };
  }
};

const failures: {
  [Tag in ToolFailure["_tag"]]: (failure: Extract<ToolFailure, { _tag: Tag }>, context: CallContext) => CallToolResult;
} = {
  InvalidArguments: (e) => errorText({ error: "invalid_arguments", message: e.message }),
  ConnectionUnavailable: (e, context) => errorText(connectionMessage(e.choice, context)),
  AscApiError: (e) =>
    errorText({
      error: "app_store_connect",
      status: e.status,
      errors: e.errors.map(({ status, code, title, detail, source }) => ({
        status,
        code,
        title,
        detail,
        ...(source ? { source } : {}),
      })),
      ...rateLimitOf(e.rateLimit),
    }),
  AscRateLimited: (e) =>
    errorText({
      error: "rate_limited",
      message: `This key used up its hourly App Store Connect quota${
        e.retryAfterSeconds === undefined ? "" : `. Retry in ${e.retryAfterSeconds} seconds`
      }.`,
      ...rateLimitOf(e.rateLimit),
    }),
  AscNetworkError: () => errorText({ error: "network", message: "Could not reach App Store Connect. Try again." }),
  AscInvalidPath: (e) =>
    errorText({
      error: "invalid_path",
      message: `${e.path} is not an App Store Connect API path. Use /v1/... or a links.next URL on https://api.appstoreconnect.apple.com.`,
    }),
  AscAuthError: (_, { webOrigin }) =>
    errorText({
      error: "key_unusable",
      message: `This connection's private key cannot sign tokens. Remove it and add the key again at ${webOrigin}.`,
    }),
  DatabaseError: internal,
  DecryptError: internal,
};

const failureResult = (failure: ToolFailure, context: CallContext) =>
  (failures[failure._tag] as (failure: ToolFailure, context: CallContext) => CallToolResult)(failure, context);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const compactResource = (resource: unknown) => {
  if (!isRecord(resource)) return resource;
  const { links: _links, relationships, ...rest } = resource;
  const kept = Object.entries(isRecord(relationships) ? relationships : {}).flatMap(([name, relationship]) => {
    if (!isRecord(relationship)) return [];
    const { links: _relationshipLinks, ...linkage } = relationship;
    return Object.keys(linkage).length > 0 ? [[name, linkage] as const] : [];
  });
  return kept.length > 0 ? { ...rest, relationships: Object.fromEntries(kept) } : rest;
};

export const compactBody = (body: unknown) => {
  if (!isRecord(body) || !("data" in body)) return body;
  const next = isRecord(body.links) ? body.links.next : undefined;
  const paging = isRecord(body.meta) ? body.meta.paging : undefined;
  return {
    data: Array.isArray(body.data) ? body.data.map(compactResource) : compactResource(body.data),
    ...(Array.isArray(body.included) ? { included: body.included.map(compactResource) } : {}),
    ...(typeof next === "string" ? { links: { next } } : {}),
    ...(paging === undefined ? {} : { meta: { paging } }),
  };
};

const successResult = ({ status, rateLimit, body }: AscResponse): CallToolResult => {
  switch (body.kind) {
    case "json":
      return text({ ...(compactBody(body.value) as object), ...rateLimitOf(rateLimit) });
    case "empty":
      return text({ ok: true, status, ...rateLimitOf(rateLimit) });
    case "bytes":
      return errorText({
        error: "unsupported_body",
        message: `App Store Connect answered with ${body.contentType} (${body.value.length} bytes). Binary responses such as reports are not supported yet.`,
      });
  }
};

const decodeArguments = (tool: AscTool<unknown>, args: Record<string, unknown>) =>
  Effect.gen(function* () {
    const { connection_id: connectionId, ...rest } = args;
    if (connectionId !== undefined && typeof connectionId !== "string") {
      return yield* new InvalidArguments({ message: "connection_id must be a string" });
    }
    const input = yield* Schema.decodeUnknownEffect(tool.input)(rest, { onExcessProperty: "error" }).pipe(
      Effect.mapError((error) => new InvalidArguments({ message: error.message })),
    );
    return { input, connectionId };
  });

export const callAscTool = (tool: AscTool<unknown>, args: Record<string, unknown>, context: CallContext) =>
  Effect.gen(function* () {
    const { input, connectionId } = yield* decodeArguments(tool, args);
    const choice = resolveConnection(yield* listConnections(context.caller.claims), connectionId);
    if (!choice.ok) return yield* new ConnectionUnavailable({ choice });
    const credentials = yield* storedCredentials(choice.connection);
    const response = yield* AscClient.use((client) => client.request(credentials, tool.toRequest(input)));
    return successResult(response);
  }).pipe(Effect.catch((failure) => Effect.succeed(failureResult(failure, context))));

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

const CONNECTION_ID = {
  type: "string",
  description: "Connection id from list_connections. Leave it out when the user has exactly one connection.",
};

const definitionOf = (tool: AscTool<unknown>): Tool => {
  const { schema } = Schema.toJsonSchemaDocument(tool.input);
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    annotations: tool.annotations,
    inputSchema: {
      ...schema,
      type: "object",
      properties: { ...(isRecord(schema.properties) ? schema.properties : {}), connection_id: CONNECTION_ID },
      additionalProperties: false,
    },
  };
};

export const toolDefinitions: ReadonlyArray<Tool> = [listConnectionsTool, ...ascTools.map(definitionOf)];

type Handler = (args: Record<string, unknown>, context: CallContext) => Effect.Effect<CallToolResult, never, Services>;

export const handlers: ReadonlyMap<string, Handler> = new Map<string, Handler>([
  [
    listConnectionsTool.name,
    (_, context) =>
      listConnections(context.caller.claims).pipe(
        Effect.map((connections) =>
          text({
            connections: connections.map((connection) => connectionSummary(connection, context.caller)),
            ...(connections.length === 0 ? { hint: `Add an App Store Connect API key at ${context.webOrigin}` } : {}),
          }),
        ),
        Effect.catch((failure) => Effect.succeed(internal(failure))),
      ),
  ],
  ...ascTools.map((tool): [string, Handler] => [tool.name, (args, context) => callAscTool(tool, args, context)]),
]);
