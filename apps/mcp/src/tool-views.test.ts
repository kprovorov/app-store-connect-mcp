import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { operations } from "./operations";
import { registry } from "./registry";
import { GOOD_TOKEN, ISSUER, RESOURCE_URL, callerFor, rpc, testApp } from "./testing";
import { operationGroups, presets } from "./tool-groups";
import { PAGE_BYTES } from "./tool-views";

let test: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { test = await testApp({ caller: callerFor("user_views", []) }); });
afterAll(() => test.dispose());
const request = (path: string, method = "tools/list", params: Record<string, unknown> = {}) => rpc(test.app, method, params, GOOD_TOKEN, path);
const call = (path: string, name: string, args: Record<string, unknown> = {}) => request(path, "tools/call", { name, arguments: args });
const value = (body: any) => JSON.parse(body.result.content[0].text);
const allTools = async (path: string) => {
  const tools: Tool[] = [];
  let cursor: string | undefined;
  const cursors = new Set<string>();
  do {
    const { response, body } = await request(path, "tools/list", cursor ? { cursor } : {});
    expect(response.status).toBe(200);
    expect(body.error).toBeUndefined();
    expect(Buffer.byteLength(JSON.stringify(body.result))).toBeLessThanOrEqual(PAGE_BYTES);
    expect(body.result.tools.length).toBeLessThanOrEqual(100);
    tools.push(...body.result.tools);
    cursor = body.result.nextCursor;
    if (cursor) {
      expect(cursors.has(cursor)).toBe(false);
      cursors.add(cursor);
    }
  } while (cursor);
  return tools;
};

describe("compact discovery and execution", () => {
  it("searches, pages, describes exact schemas, and exposes configuration choices", async () => {
    const first = await call("/", "discover", { text: "apps", limit: 1 });
    expect(value(first.body)).toMatchObject({ groups: expect.arrayContaining(["apps", "testflight"]), presets, nextOffset: 1 });
    const second = await call("/", "discover", { text: "apps", limit: 1, offset: 1 });
    expect(value(second.body).tools[0].tool).not.toBe(value(first.body).tools[0].tool);
    const described = await call("/", "discover", { tool: "apps_getInstance" });
    expect(value(described.body)).toMatchObject({ tool: "asc_apps_getInstance", operation: "apps_getInstance", executionTool: "execute", argumentsSchema: { type: "object", required: ["path"] } });
    expect(value(described.body).argumentsSchema.properties).not.toHaveProperty("connection_id");
    const alias = await call("/", "discover", { tool: "get_app" });
    expect(value(alias.body).argumentsSchema.properties).toHaveProperty("app_id");
    const upload = await call("/", "discover", { tool: "upload_screenshot" });
    expect(value(upload.body).readOnly).toBe(false);
    const connections = await call("/", "discover", { tool: "list_connections" });
    expect(value(connections.body).argumentsSchema).toMatchObject({ properties: {}, additionalProperties: false });
  });

  it("dispatches discovered names and operation IDs through the same argument validation", async () => {
    for (const tool of ["apps_getInstance", "asc_apps_getInstance", "get_app"]) {
      const { body } = await call("/", "execute", { tool });
      expect(body.result.isError).toBe(true);
      expect(value(body).error).toBe("invalid_arguments");
      expect(value(body).message).not.toContain("unavailable");
    }
    for (const args of [{ tool: "get_app", arguments: { connection_id: "x" } }, { tool: "get_app", connection_id: "" }, { tool: "get_app", extra: true }, { tool: "unknown" }]) {
      expect((await call("/", "execute", args)).body.result.isError).toBe(true);
    }
    for (const args of [{ limit: 0 }, { offset: -1 }, { text: 42 }, { tool: "get_app", text: "app" }, { tool: "missing" }]) {
      expect((await call("/", "discover", args)).body.result.isError).toBe(true);
    }
  });
});

describe("URL selectors and presets", () => {
  it("advertises exact tool selectors and intersects groups and preset selections", async () => {
    expect((await allTools("/?tools=list_apps,get_app")).map((tool) => tool.name)).toEqual(["get_app", "list_apps"]);
    expect((await allTools("/?tools=apps_getInstance")).map((tool) => tool.name)).toEqual(["asc_apps_getInstance"]);
    const groupTools = await allTools("/?groups=apps,testflight");
    expect(groupTools.map((tool) => tool.name)).toEqual(expect.arrayContaining(["list_apps", "list_beta_groups", operations.find((operation) => operation.path === "/v1/apps/{id}/betaGroups" && operation.method === "GET")!.name]));
    expect(groupTools.some((tool) => ["execute", "discover", "asc_get", "upload_screenshot"].includes(tool.name))).toBe(false);
    expect((await allTools("/dev?groups=testflight&tools=list_apps,list_beta_groups")).map((tool) => tool.name)).toEqual(["list_beta_groups"]);
    expect(await allTools("/analytics?tools=add_beta_tester")).toEqual([]);
  });

  it.each([
    ["dev", ["list_builds", "list_ci_build_runs", "asc_certificates_getCollection"]],
    ["aso", ["list_customer_reviews", "update_version_localization", "upload_screenshot", "apps_searchKeywords_getToManyRelated", "apps_searchKeywords_getToManyRelationship", "apps_marketplaceSearchDetail_getToOneRelated", "apps_marketplaceSearchDetail_getToOneRelationship"]],
    ["testflight", ["list_beta_groups", "set_what_to_test", "asc_betaTesters_createInstance"]],
    ["analytics", ["get_app_perf_metrics", "asc_salesReports_getCollection", "analyticsReportRequests_createInstance", "apps_performanceOverviews_getToManyRelated", "apps_betaTesterUsages_getMetrics"]],
  ])("provides the %s role's operations and app context", async (preset, expected) => {
    const tools = await allTools(`/${preset}`);
    expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(["list_apps", "get_app", "list_connections", ...expected.map((name) => operations.find((operation) => operation.operationId === name)?.name ?? name)]));
    expect(tools.some((tool) => ["asc_get", "execute", "asc_write_operation"].includes(tool.name))).toBe(false);
  });

  it.each(["/?tools=", "/?tools=list_apps,", "/?tools=missing", "/?groups=", "/?groups=apps,,testflight", "/?groups=missing", "/?mode=", "/?mode=write", "/?mode=readonly&mode=readonly", "/?groups=apps&groups=testflight", "/?tools=list_apps&tools=get_app", "/?typo=apps"])("rejects invalid selectors %s", async (path) => {
    const { response } = await request(path);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_view" });
  });

  it.each(["/unknown", "/dev/unknown", "/DEV", "/.well-known/oauth-protected-resource/unknown"])("does not route unknown paths %s", async (path) => {
    expect((await request(path)).response.status).toBe(404);
  });

  it("authenticates views before parsing selectors and retains canonical OAuth metadata", async () => {
    for (const path of ["/dev", "/aso", "/testflight", "/analytics", "/full", "/?tools=bad"]) {
      const denied = await rpc(test.app, "tools/list", {}, null, path);
      expect(denied.response.status).toBe(401);
      expect(denied.response.headers.get("www-authenticate")).toContain(`${RESOURCE_URL}/.well-known/oauth-protected-resource`);
    }
    for (const path of Object.keys(presets)) {
      const metadata = await test.app.request(`/.well-known/oauth-protected-resource/${path}`);
      expect(metadata.status).toBe(200);
      expect(await metadata.json()).toMatchObject({ resource: RESOURCE_URL, authorization_servers: [ISSUER] });
      const get = await test.app.request(`/${path}`, { headers: { authorization: `Bearer ${GOOD_TOKEN}` } });
      expect(get.status).toBe(405);
    }
  });
});

describe("read-only and tool-call policy", () => {
  it("blocks every generated write and all convenience/upload writes before service access", async () => {
    const { body } = await request("/?mode=readonly");
    expect(body.result.tools.find((tool: Tool) => tool.name === "execute").annotations.readOnlyHint).toBe(true);
    const writes = [...registry.values()].filter((entry) => entry.definition.annotations?.readOnlyHint !== true);
    for (const entry of writes) {
      const denied = await call("/?mode=readonly", "execute", { tool: entry.operation?.operationId ?? entry.definition.name });
      expect(denied.body.result.isError, entry.definition.name).toBe(true);
      expect(value(denied.body).message, entry.definition.name).toBe("Tool is unavailable in this view");
    }
    const described = await call("/?mode=readonly", "discover", { tool: "upload_asset" });
    expect(described.body.result.isError).toBe(true);
    const searched = await call("/?mode=readonly", "discover", { text: "POST", limit: 100 });
    expect(value(searched.body).tools.every((tool: { readOnly: boolean }) => tool.readOnly)).toBe(true);
  });

  it("enforces selected names on direct calls and isolates concurrent request views", async () => {
    for (const [path, name] of [["/?tools=list_apps", "get_app"], ["/analytics", "upload_screenshot"], ["/testflight?mode=readonly", "add_beta_tester"], ["/full?mode=readonly", "asc_bundleIds_deleteInstance"], ["/?groups=apps", "asc_get"], ["/full", "execute"], ["/full", "asc_write_operation"], ["/full", "asc_read_operation"]]) {
      const denied = await call(path!, name!);
      expect(denied.body.error.code).toBe(-32602);
    }
    const [readOnly, writable, narrow] = await Promise.all([allTools("/testflight?mode=readonly"), allTools("/testflight"), allTools("/?tools=get_app")]);
    expect(readOnly.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
    expect(writable.some((tool) => tool.name === "add_beta_tester")).toBe(true);
    expect(narrow.map((tool) => tool.name)).toEqual(["get_app"]);
    expect((await allTools("/?tools=asc_get")).map((tool) => tool.name)).toEqual(["asc_get"]);
    expect(await allTools("/?tools=asc_get&groups=apps")).toEqual([]);
  });
});

describe("full catalog pages", () => {
  it("advertises every pinned operation once with its exact schema and method annotations", async () => {
    const tools = await allTools("/full");
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    expect(byName.size).toBe(tools.length);
    expect(byName.size).toBe(registry.size);
    for (const operation of operations) {
      expect(byName.get(operation.name)?.inputSchema, operation.operationId).toEqual(operation.inputSchema);
      expect(byName.get(operation.name)?.annotations?.readOnlyHint).toBe(operation.method === "GET");
      expect(operationGroups(operation)).not.toHaveLength(0);
    }
    expect(byName.has("asc_get")).toBe(true);
  });

  it("binds cursors to their view and rejects malformed, stale and out-of-range cursors", async () => {
    const first = await request("/full");
    const cursor = first.body.result.nextCursor;
    expect(cursor).toBeTypeOf("string");
    for (const path of ["/", "/full?mode=readonly", "/?groups=apps"]) {
      expect((await request(path, "tools/list", { cursor })).body.error.code).toBe(-32602);
    }
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString());
    for (const invalid of ["", "!", "e30", Buffer.from(JSON.stringify({ ...parsed, offset: -1 })).toString("base64url"), Buffer.from(JSON.stringify({ ...parsed, offset: registry.size })).toString("base64url")]) {
      expect((await request("/full", "tools/list", { cursor: invalid })).body.error.code).toBe(-32602);
    }
    const second = await request("/full", "tools/list", { cursor });
    expect(second.body.result.tools[0].name).not.toBe(first.body.result.tools[0].name);
  });
});
