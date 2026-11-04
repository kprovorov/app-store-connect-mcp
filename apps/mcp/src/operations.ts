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
export const discoveryDefinitions: Tool[] = [
  { name: "asc_find_operations", description: "Search every operation in the pinned Apple API by operation ID, method, or path. Returns operation IDs for asc_read_operation or asc_write_operation. Includes deprecated operations.", inputSchema: { type: "object", properties: { text: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "asc_describe_operation", description: "Get the arguments schema and read or write execution tool for an Apple operation ID. Pass connection_id outside arguments when executing.", inputSchema: { type: "object", properties: { operation: { type: "string", minLength: 1 } }, required: ["operation"], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
];
export const invocationDefinitions: Tool[] = ["read", "write"].map((kind) => ({
  name: `asc_${kind}_operation`,
  description: `Execute any catalog ${kind === "read" ? "GET" : "POST, PATCH, or DELETE"} by its Apple operation ID. Use asc_find_operations to search and asc_describe_operation for the exact arguments schema. Pass connection_id here, outside arguments.`,
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
    const { connection_id: _, ...properties } = operation.inputSchema.properties as Record<string, unknown>;
    return { version: catalog.version, operation: operation.operationId, method: operation.method, path: operation.path, deprecated: operation.deprecated, argumentsSchema: { ...operation.inputSchema, properties }, executionTool: operation.method === "GET" ? "asc_read_operation" : "asc_write_operation" };
  }
  const terms = String(args.text ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const matches = operations.filter((operation) => terms.every((term) => `${operation.operationId} ${operation.method} ${operation.path}`.toLowerCase().includes(term)));
  return { version: catalog.version, total: matches.length, operations: matches.slice(0, Number(args.limit ?? 25)).map(({ operationId, method, path, deprecated }) => ({ operation: operationId, method, path, deprecated })) };
};
