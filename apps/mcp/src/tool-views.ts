import { createHash } from "node:crypto";
import { Ajv } from "ajv";
import { ErrorCode, McpError, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { catalog } from "./operations";
import { entriesByOperationId, registry, type ToolEntry } from "./registry";
import { groups, presets, type Preset, type ToolGroup } from "./tool-groups";

export interface ToolView {
  readonly kind: "compact" | "direct";
  readonly entries: ReadonlyMap<string, ToolEntry>;
  readonly readOnly: boolean;
  readonly fingerprint: string;
}

export const presetPaths = Object.keys(presets).map((preset) => `/${preset}`);
export const isMcpPath = (path: string) => path === "/" || presetPaths.includes(path);

const parameter = (url: URL, name: string) => {
  const values = url.searchParams.getAll(name);
  if (values.length > 1) throw new Error(`Repeat values inside ${name}, not the parameter itself`);
  if (values[0] === "") throw new Error(`${name} cannot be empty`);
  return values[0];
};
const selection = (value: string | undefined) => {
  if (value === undefined) return undefined;
  const items = value.split(",").map((item) => item.trim());
  if (items.some((item) => !item)) throw new Error("Selectors cannot contain empty items");
  return new Set(items);
};
const entryNamed = (name: string) => registry.get(name) ?? entriesByOperationId.get(name);

export const resolveView = (url: URL): ToolView => {
  if (!isMcpPath(url.pathname)) throw new Error("Unknown MCP preset");
  for (const key of url.searchParams.keys()) if (!["tools", "groups", "mode"].includes(key)) throw new Error(`Unknown query parameter: ${key}`);
  const tools = selection(parameter(url, "tools"));
  const selectedGroups = selection(parameter(url, "groups"));
  const mode = parameter(url, "mode");
  if (mode !== undefined && mode !== "readonly") throw new Error("mode must be readonly");
  const names = tools && new Set([...tools].map((name) => {
    const entry = entryNamed(name);
    if (!entry) throw new Error(`Unknown tool: ${name}`);
    return entry.definition.name;
  }));
  for (const group of selectedGroups ?? []) if (!groups.includes(group as ToolGroup)) throw new Error(`Unknown group: ${group}`);
  const preset = url.pathname === "/" ? undefined : url.pathname.slice(1) as Preset;
  const presetGroups: readonly ToolGroup[] | undefined = preset && preset !== "full" ? presets[preset] : undefined;
  const direct = preset !== undefined || tools !== undefined || selectedGroups !== undefined;
  const entries = new Map([...registry].filter(([name, entry]) =>
    (!names || names.has(name)) &&
    (!selectedGroups || entry.groups.some((group) => selectedGroups.has(group))) &&
    (!presetGroups || entry.groups.some((group) => presetGroups.includes(group))) &&
    (!entry.unrestricted || (!selectedGroups && !presetGroups)) &&
    (mode !== "readonly" || entry.definition.annotations?.readOnlyHint === true),
  ));
  return {
    kind: direct ? "direct" : "compact", entries, readOnly: mode === "readonly",
    fingerprint: createHash("sha256").update(JSON.stringify([catalog.sha256, direct, mode, [...entries.keys()]])).digest("hex").slice(0, 24),
  };
};

const readAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const discoverDefinition: Tool = {
  name: "discover",
  description: "Find App Store Connect tools by text, or pass tool for the exact argumentsSchema. Accepts convenience names, generated MCP names, and Apple operation IDs. Returns groups and presets. Pass connection_id outside arguments when using execute.",
  inputSchema: {
    type: "object", properties: { tool: { type: "string", minLength: 1 }, text: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 }, offset: { type: "integer", minimum: 0 } }, additionalProperties: false,
  },
  annotations: readAnnotations,
};
const executeDefinition: Tool = {
  name: "execute",
  description: "Execute a tool found with discover. tool accepts a convenience name, generated MCP name, or Apple operation ID. arguments must match its argumentsSchema. connection_id goes outside arguments. Includes list_connections and upload helpers.",
  inputSchema: { type: "object", properties: { tool: { type: "string", minLength: 1 }, arguments: { type: "object", additionalProperties: true }, connection_id: { type: "string", minLength: 1 } }, required: ["tool"], additionalProperties: false },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
};
const ajv = new Ajv({ strict: false, ownProperties: true });
const validateDiscover = ajv.compile(discoverDefinition.inputSchema);
const validateExecute = ajv.compile(executeDefinition.inputSchema);

export const PAGE_BYTES = 512 * 1024;
const PAGE_COUNT = 100;
export const listTools = (view: ToolView, cursor?: string) => {
  if (view.kind === "compact") {
    if (cursor !== undefined) throw new McpError(ErrorCode.InvalidParams, "The compact tool list has no further pages");
    return { tools: [discoverDefinition, { ...executeDefinition, annotations: view.readOnly ? { ...readAnnotations, openWorldHint: true } : executeDefinition.annotations }] };
  }
  const definitions = [...view.entries.values()].map((entry) => entry.definition);
  let offset = 0;
  if (cursor !== undefined) {
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
      const decoded = Buffer.from(cursor, "base64url");
      if (decoded.toString("base64url") !== cursor) throw new Error();
      const parsed = JSON.parse(decoded.toString()) as { fingerprint?: unknown; offset?: unknown };
      if (parsed.fingerprint !== view.fingerprint || !Number.isSafeInteger(parsed.offset) || Number(parsed.offset) < 1 || Number(parsed.offset) >= definitions.length) throw new Error();
      offset = Number(parsed.offset);
    } catch {
      throw new McpError(ErrorCode.InvalidParams, "Invalid cursor for this tool view");
    }
  }
  const tools: Tool[] = [];
  let bytes = 256;
  while (offset + tools.length < definitions.length && tools.length < PAGE_COUNT) {
    const definition = definitions[offset + tools.length]!;
    const size = Buffer.byteLength(JSON.stringify(definition)) + 1;
    if (size + 256 > PAGE_BYTES) throw new McpError(ErrorCode.InternalError, `Tool schema exceeds the page limit: ${definition.name}`);
    if (bytes + size > PAGE_BYTES) break;
    tools.push(definition);
    bytes += size;
  }
  const nextOffset = offset + tools.length;
  return { tools, ...(nextOffset < definitions.length ? { nextCursor: Buffer.from(JSON.stringify({ fingerprint: view.fingerprint, offset: nextOffset })).toString("base64url") } : {}) };
};

export const allowedEntry = (view: ToolView, name: string) => {
  const entry = entryNamed(name);
  return entry && view.entries.get(entry.definition.name);
};
const summary = (entry: ToolEntry) => ({
  tool: entry.definition.name, description: entry.definition.description, groups: entry.groups,
  readOnly: entry.definition.annotations?.readOnlyHint === true,
  ...(entry.operation ? { operation: entry.operation.operationId, method: entry.operation.method, path: entry.operation.path, deprecated: entry.operation.deprecated } : {}),
});

export const discover = (view: ToolView, args: Record<string, unknown>) => {
  if (!validateDiscover(args)) throw new Error(ajv.errorsText(validateDiscover.errors));
  if (args.tool !== undefined) {
    if (Object.keys(args).length !== 1) throw new Error("Pass tool alone for an exact schema, or text, offset and limit for search");
    const entry = allowedEntry(view, String(args.tool));
    if (!entry) throw new Error("Tool is unavailable in this view");
    const { connection_id: _, ...properties } = entry.definition.inputSchema.properties ?? {};
    return { ...summary(entry), version: catalog.version, argumentsSchema: { ...entry.definition.inputSchema, properties }, executionTool: "execute" };
  }
  const terms = String(args.text ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const matches = [...view.entries.values()].filter((entry) => terms.every((term) => JSON.stringify(summary(entry)).toLowerCase().includes(term)));
  const offset = Number(args.offset ?? 0);
  const limit = Number(args.limit ?? 25);
  return { version: catalog.version, groups, presets, total: matches.length, tools: matches.slice(offset, offset + limit).map(summary), ...(offset + limit < matches.length ? { nextOffset: offset + limit } : {}) };
};

export const execution = (view: ToolView, args: Record<string, unknown>) => {
  if (!validateExecute(args)) throw new Error(ajv.errorsText(validateExecute.errors));
  const entry = allowedEntry(view, String(args.tool));
  if (!entry) throw new Error("Tool is unavailable in this view");
  const input = (args.arguments ?? {}) as Record<string, unknown>;
  if ("connection_id" in input) throw new Error("Pass connection_id outside arguments");
  return { entry, arguments: { ...input, ...(args.connection_id === undefined ? {} : { connection_id: args.connection_id }) } };
};
