import { Ajv, type ValidateFunction } from "ajv";
import type { AscRequest } from "@asc-mcp/asc";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Operation } from "./catalog-builder";
import generated from "./generated/operations.json" with { type: "json" };

export const catalog = generated as unknown as { version: string; sha256: string; operations: Operation[] };
export const operations = catalog.operations;
export const operationsByName = new Map(operations.map((operation) => [operation.name, operation]));
export const operationsById = new Map(operations.map((operation) => [operation.operationId, operation]));
const ajv = new Ajv({ strict: false, allErrors: false, validateFormats: false, ownProperties: true });
const validators = new Map<string, ValidateFunction>();
export const validatorFor = (operation: Operation) => {
  let validator = validators.get(operation.name);
  if (!validator) { validator = ajv.compile(operation.inputSchema); validators.set(operation.name, validator); }
  return validator;
};
export const validateOperation = (operation: Operation, args: unknown) => {
  const validate = validatorFor(operation);
  if (!validate(args)) throw new Error(ajv.errorsText(validate.errors, { separator: "; " }));
};
export const operationRequest = (operation: Operation, args: Record<string, unknown>): AscRequest => {
  validateOperation(operation, args);
  const path = args.path as Record<string, string> | undefined;
  return {
    method: operation.method,
    path: operation.path.replace(/\{([^}]+)\}/g, (_, key: string) => encodeURIComponent(path![key]!)),
    ...(args.query ? { query: args.query as AscRequest["query"] } : {}),
    ...(args.body !== undefined ? { body: args.body } : {}),
    accept: typeof args.accept === "string" ? args.accept : operation.responseMedia.find((media) => media.includes("json")) ?? operation.responseMedia[0] ?? "application/json",
    scoped: operation.method === "GET",
  };
};
export const operationDefinition = (operation: Operation): Tool => ({
  name: operation.name,
  title: operation.operationId,
  description: `${operation.method} ${operation.path}. Apple operation ${operation.operationId}.${operation.deprecated ? " Deprecated by Apple; prefer the current replacement." : ""} Pass Apple's JSON:API body unchanged. Binary reports return a bounded base64 resource; use response_offset and response_limit to retrieve subsequent bytes.`,
  inputSchema: operation.inputSchema,
  annotations: { readOnlyHint: operation.method === "GET", destructiveHint: operation.method !== "GET", idempotentHint: ["GET", "DELETE"].includes(operation.method), openWorldHint: true },
});
export const operationDefinitions = operations.map(operationDefinition);

export const discoveryDefinitions: Tool[] = [
  { name: "asc_find_operations", description: "Search every operation in the pinned Apple API by operation id, method, or path. Returns generated tool names. Includes deprecated operations.", inputSchema: { type: "object", properties: { text: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "asc_describe_operation", description: "Get a generated tool and its complete input schema by Apple operation id or MCP tool name.", inputSchema: { type: "object", properties: { operation: { type: "string", minLength: 1 } }, required: ["operation"], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
];
export const invocationDefinitions: Tool[] = ["read", "write"].map((kind) => ({
  name: `asc_${kind}_operation`,
  description: `Execute a catalog ${kind === "read" ? "GET" : "POST, PATCH, or DELETE"} by its Apple operation ID. Use asc_describe_operation for the exact arguments schema. This fallback reaches the full catalog when a client limits tool discovery. Pass connection_id here, outside arguments.`,
  inputSchema: {
    type: "object",
    properties: { operation: { type: "string", minLength: 1 }, arguments: { type: "object", additionalProperties: true }, connection_id: { type: "string", minLength: 1 } },
    required: ["operation"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: kind === "read", destructiveHint: kind === "write", idempotentHint: kind === "read", openWorldHint: true },
}));

export const resolveInvocation = (name: string, args: Record<string, unknown>) => {
  const definition = invocationDefinitions.find((tool) => tool.name === name)!;
  const validate = ajv.compile(definition.inputSchema);
  if (!validate(args)) throw new Error(ajv.errorsText(validate.errors));
  const operation = operationsById.get(String(args.operation));
  if (!operation) throw new Error("Unknown Apple operation");
  if ((name === "asc_read_operation") !== (operation.method === "GET")) throw new Error("Use asc_read_operation for GET and asc_write_operation for mutations");
  const input = (args.arguments ?? {}) as Record<string, unknown>;
  if ("connection_id" in input) throw new Error("Pass connection_id outside arguments");
  return { operation, arguments: { ...input, ...(args.connection_id === undefined ? {} : { connection_id: args.connection_id }) } };
};

export const discoverOperation = (name: string, args: Record<string, unknown>) => {
  const definition = discoveryDefinitions.find((tool) => tool.name === name)!;
  const validate = ajv.compile(definition.inputSchema);
  if (!validate(args)) throw new Error(ajv.errorsText(validate.errors));
  if (name === "asc_describe_operation") {
    const operation = operationsByName.get(String(args.operation)) ?? operationsById.get(String(args.operation));
    if (!operation) throw new Error("Unknown Apple operation");
    return { version: catalog.version, tool: operationDefinition(operation), executionTool: operation.method === "GET" ? "asc_read_operation" : "asc_write_operation" };
  }
  const terms = String(args.text ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const matches = operations.filter((operation) => terms.every((term) => `${operation.operationId} ${operation.method} ${operation.path}`.toLowerCase().includes(term)));
  return { version: catalog.version, total: matches.length, operations: matches.slice(0, Number(args.limit ?? 25)).map(({ inputSchema: _, ...operation }) => operation) };
};

export const MAX_CATALOG_PAGE_BYTES = 1024 * 1024;
export const catalogPage = (definitions: readonly Tool[], cursor?: string) => {
  let offset = 0;
  if (cursor !== undefined) {
    const prefix = `${catalog.sha256.slice(0, 12)}:`;
    if (!cursor.startsWith(prefix) || !/^\d+$/.test(cursor.slice(prefix.length))) throw new Error("Invalid tools cursor");
    offset = Number(cursor.slice(prefix.length));
    if (!Number.isSafeInteger(offset) || offset < 1 || offset >= definitions.length) throw new Error("Invalid tools cursor");
  }
  const tools: Tool[] = [];
  let bytes = 100;
  while (offset < definitions.length && tools.length < 50) {
    const tool = definitions[offset]!;
    const size = Buffer.byteLength(JSON.stringify(tool)) + 1;
    if (size + 100 > MAX_CATALOG_PAGE_BYTES) throw new Error(`Tool schema exceeds catalog page budget: ${tool.name}`);
    if (bytes + size > MAX_CATALOG_PAGE_BYTES) break;
    tools.push(tool); bytes += size; offset++;
  }
  return { tools, ...(offset < definitions.length ? { nextCursor: `${catalog.sha256.slice(0, 12)}:${offset}` } : {}) };
};
