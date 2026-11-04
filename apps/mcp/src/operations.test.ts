import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { buildCatalog, normalizeSchema, type Specification } from "./catalog-builder";
import { catalog, discoverOperation, operations, operationRequest, operationsById, validateOperation, validatorFor } from "./operations";
import { successResult } from "./registry";

const source = readFileSync(new URL("../spec/app-store-connect-4.5.1.json", import.meta.url));
const spec = JSON.parse(source.toString()) as Specification;
const named = (id: string) => operationsById.get(id)!;

describe("Apple specification coverage", () => {
  it("pins every method/path and preserves request and response coverage independently of generation", () => {
    expect(createHash("sha256").update(source).digest("hex")).toBe(catalog.sha256);
    const expected: string[] = [];
    for (const [path, item] of Object.entries(spec.paths)) for (const [method, raw] of Object.entries(item)) {
      if (!["get", "post", "patch", "delete"].includes(method)) continue;
      const operation = raw as { operationId: string; deprecated?: boolean; requestBody?: unknown; responses: Record<string, { content?: Record<string, unknown> }> };
      expected.push(`${method.toUpperCase()} ${path}`);
      const generated = named(operation.operationId);
      expect(generated, operation.operationId).toBeDefined();
      expect(`${generated.method} ${generated.path}`).toBe(`${method.toUpperCase()} ${path}`);
      expect(generated.deprecated).toBe(Boolean(operation.deprecated));
      expect(Boolean((generated.inputSchema.properties as Record<string, unknown>).body)).toBe(Boolean(operation.requestBody));
      expect(generated.responseMedia.slice().sort()).toEqual([...new Set(Object.entries(operation.responses).filter(([status]) => status.startsWith("2")).flatMap(([, response]) => Object.keys(response.content ?? {})))].sort());
      for (const match of path.matchAll(/\{([^}]+)\}/g)) {
        const pathSchema = (generated.inputSchema.properties as Record<string, Record<string, unknown>>).path!;
        expect(pathSchema.required).toContain(match[1]);
      }
    }
    expect(operations.map((operation) => `${operation.method} ${operation.path}`).sort()).toEqual(expected.sort());
    expect(operations).toHaveLength(1303);
    expect(operations.filter((operation) => operation.deprecated)).toHaveLength(159);
    expect(new Set(operations.map((operation) => operation.name)).size).toBe(1303);
    expect(operations.every((operation) => /^[a-zA-Z0-9_-]{1,40}$/.test(operation.name))).toBe(true);
  });

  it("compiles every exact advertised input schema and reproduces the committed output", () => {
    for (const operation of operations) expect(() => validatorFor(operation), operation.operationId).not.toThrow();
    expect(buildCatalog(spec)).toEqual(operations);
    execFileSync(process.execPath, ["scripts/generate-catalog.ts", "--check"], { cwd: new URL("../", import.meta.url) });
  });

  it("discovers operation IDs and describes arguments for the compact execution tools", () => {
    const found = discoverOperation("asc_find_operations", { text: "apps_getInstance" });
    expect(found).toMatchObject({ total: 1, operations: [{ operation: "apps_getInstance", method: "GET" }] });
    const read = discoverOperation("asc_describe_operation", { operation: "apps_getInstance" });
    expect(read).toMatchObject({ operation: "apps_getInstance", executionTool: "asc_read_operation", argumentsSchema: { type: "object", required: ["path"] } });
    if (!read.argumentsSchema) throw new Error("Missing operation arguments schema");
    expect(read.argumentsSchema.properties).not.toHaveProperty("connection_id");
    expect(discoverOperation("asc_describe_operation", { operation: "appAssetLibraryPlacements_createInstance" })).toMatchObject({ executionTool: "asc_write_operation" });
  });
});

describe("generated request contracts", () => {
  it("validates and encodes required ids and comma-separated array queries", () => {
    const operation = named("apps_getInstance");
    expect(operationRequest(operation, { path: { id: "a/b" }, query: { "fields[apps]": ["name", "bundleId"] } })).toMatchObject({ method: "GET", path: "/v1/apps/a%2Fb", query: { "fields[apps]": ["name", "bundleId"] }, scoped: true });
    for (const id of ["", ".", ".."]) expect(() => operationRequest(operation, { path: { id } })).toThrow();
    expect(() => operationRequest(operation, { path: { id: "1" }, query: { "fields[apps]": ["misspelled"] } })).toThrow();
    expect(() => operationRequest(operation, { path: { id: "1" }, unexpected: true })).toThrow();
  });

  it("preserves Apple's anyOf localization rules and accepts fields Apple leaves open", () => {
    const operation = named("appAssetLibraryPlacements_createInstance");
    const body = { data: { type: "appAssetLibraryPlacements", attributes: { placementType: "APP_SCREENSHOT", placementGroup: "IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE" }, relationships: { image: { data: { type: "appAssetLibraryImages", id: "i" } }, appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: "l" } } } } };
    expect(() => validateOperation(operation, { body })).not.toThrow();
    expect(() => validateOperation(operation, { body: { data: { ...body.data, relationships: {} } } })).toThrow();
    expect(() => validateOperation(operation, { body: { ...body, futureAppleField: true } })).not.toThrow();
  });

  it("accepts nullable Apple attributes and enforces included-resource oneOf branches", () => {
    const tester = { body: { data: { type: "betaTesters", attributes: { email: "tester@example.test", firstName: null, futureAppleField: "preserved" } } } };
    expect(() => validateOperation(named("betaTesters_createInstance"), tester)).not.toThrow();
    expect(operationRequest(named("betaTesters_createInstance"), tester).body).toEqual(tester.body);
    const subscription = { path: { id: "s1" }, body: { data: { type: "subscriptions", id: "s1" }, included: [{ type: "subscriptionPrices" }] } };
    expect(() => validateOperation(named("subscriptions_updateInstance"), subscription)).not.toThrow();
    expect(() => validateOperation(named("subscriptions_updateInstance"), { ...subscription, body: { ...subscription.body, included: [{ type: "apps" }] } })).toThrow();
  });

  it("normalizes nullable references and impossible Apple enums without deleting constraints", () => {
    expect(normalizeSchema({ nullable: true, $ref: "#/components/schemas/X" })).toEqual({ anyOf: [{ $ref: "#/$defs/X" }, { type: "null" }] });
    expect(normalizeSchema({ type: "string", enum: [] })).toEqual({ not: {} });
    expect(() => operationRequest(named("salesReports_getCollection"), {})).toThrow();
  });
});

describe("binary report resources", () => {
  const response = { status: 200, rateLimit: undefined, body: { kind: "bytes" as const, contentType: "application/a-gzip", value: Buffer.from("abcdef") } };
  it("returns bounded bytes and binds later refetches to the original report hash", () => {
    const first = successResult(response, { response_limit: 3 });
    const metadata = JSON.parse((first.content[0] as { text: string }).text);
    expect(metadata).toMatchObject({ totalBytes: 6, offset: 0, nextOffset: 3, bytes: 3 });
    expect(first.content[1]).toMatchObject({ type: "resource", resource: { mimeType: "application/a-gzip", blob: Buffer.from("abc").toString("base64") } });
    const second = successResult(response, { response_offset: 3, expected_sha256: metadata.sha256 });
    expect(second.content[1]).toMatchObject({ resource: { blob: Buffer.from("def").toString("base64") } });
    expect(successResult(response, { response_offset: 3 }).isError).toBe(true);
    expect(successResult({ ...response, body: { ...response.body, value: Buffer.from("changed") } }, { response_offset: 3, expected_sha256: metadata.sha256 }).isError).toBe(true);
  });
});
