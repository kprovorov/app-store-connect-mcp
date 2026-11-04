import { createHash } from "node:crypto";

export type JsonSchema = Record<string, unknown>;
interface Parameter { name: string; in: string; required?: boolean; schema: JsonSchema; style?: string; explode?: boolean }
interface SpecificationOperation {
  operationId: string;
  deprecated?: boolean;
  parameters?: Parameter[];
  requestBody?: { required?: boolean; content: Record<string, { schema: JsonSchema }> };
  responses: Record<string, { content?: Record<string, unknown> }>;
}
export interface Specification {
  info: { version: string };
  paths: Record<string, { parameters?: Parameter[] } & Record<string, unknown>>;
  components: { schemas: Record<string, JsonSchema> };
}
export interface Operation {
  name: string;
  operationId: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  deprecated: boolean;
  inputSchema: JsonSchema & { type: "object" };
  responseMedia: string[];
}

const methods = new Set(["get", "post", "patch", "delete"]);
export const operationName = (id: string) => {
  const name = `asc_${id}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  return name.length <= 40 ? name : `${name.slice(0, 31)}_${createHash("sha256").update(id).digest("hex").slice(0, 8)}`;
};

export const normalizeSchema = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalizeSchema);
  if (!value || typeof value !== "object") return value;
  const original = value as JsonSchema;
  if (Array.isArray(original.enum) && original.enum.length === 0) return { not: {} };
  const normalized: JsonSchema = {};
  for (const [key, child] of Object.entries(original)) {
    if (["nullable", "discriminator", "xml", "example", "externalDocs"].includes(key)) continue;
    if (key === "$ref") {
      if (typeof child !== "string" || !child.startsWith("#/components/schemas/")) throw new Error(`Unsupported reference ${child}`);
      normalized.$ref = child.replace("#/components/schemas/", "#/$defs/");
    } else if ((key === "exclusiveMinimum" || key === "exclusiveMaximum") && typeof child === "boolean") {
      if (child) {
        const bound = key === "exclusiveMinimum" ? original.minimum : original.maximum;
        if (typeof bound !== "number") throw new Error(`Missing exclusive bound ${key}`);
        normalized[key] = bound;
      }
    } else normalized[key] = normalizeSchema(child);
  }
  if (original.nullable === true) return { anyOf: [normalized, { type: "null" }] };
  return normalized;
};

const references = (value: unknown, found: Set<string>) => {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) { for (const child of value) references(child, found); return; }
  for (const [key, child] of Object.entries(value)) {
    if (key === "$ref" && typeof child === "string") found.add(child.slice("#/$defs/".length));
    else references(child, found);
  }
};

export const buildCatalog = (spec: Specification): Operation[] => {
  const components = Object.fromEntries(Object.entries(spec.components.schemas).map(([key, value]) => [key, normalizeSchema(value)]));
  const output: Operation[] = [];
  const names = new Set<string>();
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const [method, candidate] of Object.entries(item)) {
      if (!methods.has(method)) {
        if (["put", "head", "options", "trace"].includes(method)) throw new Error(`Unsupported method ${method}`);
        continue;
      }
      const operation = candidate as SpecificationOperation;
      if (!operation.operationId) throw new Error(`Missing operationId ${method} ${path}`);
      const name = operationName(operation.operationId);
      if (names.has(name)) throw new Error(`Duplicate tool name ${name}`);
      names.add(name);
      const parameters = new Map<string, Parameter>();
      for (const p of [...(item.parameters ?? []), ...(operation.parameters ?? [])]) parameters.set(`${p.in}:${p.name}`, p);
      const properties: JsonSchema = {
        connection_id: { type: "string", minLength: 1, description: "Connection id from list_connections" },
        expected_sha256: { type: "string", pattern: "^[a-f0-9]{64}$", description: "SHA-256 returned by the first report chunk. Required for subsequent chunks." },
        response_offset: { type: "integer", minimum: 0, description: "Byte offset for non-JSON reports. Each call downloads the report again." },
        response_limit: { type: "integer", minimum: 1, maximum: 1048576, description: "Maximum report bytes returned, default 1048576" },
      };
      const required: string[] = [];
      for (const location of ["path", "query"]) {
        const props: JsonSchema = {};
        const needs: string[] = [];
        for (const p of parameters.values()) {
          if (p.in !== "path" && p.in !== "query") throw new Error(`Unsupported parameter location ${p.in}`);
          if (p.in !== location) continue;
          if (p.schema.type === "array" && (p.style !== "form" || p.explode !== false)) throw new Error(`Unsupported array serialization ${operation.operationId}:${p.name}`);
          props[p.name] = location === "path" ? { ...(normalizeSchema(p.schema) as JsonSchema), minLength: 1, pattern: "^(?!\\.{1,2}$)" } : normalizeSchema(p.schema);
          if (p.required || location === "path") needs.push(p.name);
        }
        if (Object.keys(props).length) {
          properties[location] = { type: "object", properties: props, additionalProperties: false, ...(needs.length ? { required: needs } : {}) };
          if (needs.length) required.push(location);
        }
      }
      if (operation.requestBody) {
        if (Object.keys(operation.requestBody.content).some((media) => media !== "application/json")) throw new Error(`Unsupported body ${name}`);
        properties.body = normalizeSchema(operation.requestBody.content["application/json"]!.schema);
        if (operation.requestBody.required) required.push("body");
      }
      const responseMedia = [...new Set(Object.entries(operation.responses).filter(([status]) => /^2/.test(status)).flatMap(([, response]) => Object.keys(response.content ?? {})))];
      if (responseMedia.length > 1) properties.accept = { type: "string", enum: responseMedia };
      const inputSchema: Operation["inputSchema"] = { type: "object", properties, additionalProperties: false, ...(required.length ? { required } : {}) };
      const needed = new Set<string>();
      references(inputSchema, needed);
      for (const ref of needed) {
        if (!(ref in components)) throw new Error(`Missing component ${ref}`);
        references(components[ref], needed);
      }
      if (needed.size) inputSchema.$defs = Object.fromEntries([...needed].sort().map((key) => [key, components[key]]));
      output.push({ name, operationId: operation.operationId, method: method.toUpperCase() as Operation["method"], path, deprecated: operation.deprecated ?? false, inputSchema, responseMedia });
    }
  }
  return output.sort((a, b) => a.operationId < b.operationId ? -1 : a.operationId > b.operationId ? 1 : 0);
};
