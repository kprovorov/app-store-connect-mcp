import { Ajv, type ValidateFunction } from "ajv";
import type { AscRequest } from "@asc-mcp/asc";
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
