import type { AscRequest } from "@asc-mcp/asc";
import type { Connection, ConnectionId, OrgId } from "@asc-mcp/db";
import { Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveConnection } from "./connections";
import { compactBody } from "./registry";
import { callerFor, rpc, testApp } from "./testing";
import { ascTools } from "./tools";
import { operations } from "./operations";

const requestFor = (name: string, args: Record<string, unknown>): AscRequest => {
  const tool = ascTools.find((candidate) => candidate.name === name)!;
  return tool.toRequest(Schema.decodeUnknownSync(tool.input)(args, { onExcessProperty: "error" }));
};
const rejects = (name: string, args: Record<string, unknown>) => {
  const tool = ascTools.find((candidate) => candidate.name === name)!;
  return Schema.decodeUnknownExit(tool.input)(args, { onExcessProperty: "error" })._tag === "Failure";
};

describe("tools/list", () => {
  const caller = callerFor("user_alice", [{ id: "org_acme", name: "Acme" }]);
  let test: Awaited<ReturnType<typeof testApp>>;
  beforeAll(async () => {
    test = await testApp({ caller });
  });
  afterAll(() => test.dispose());

  it("lists every tool with an object input schema, and connection_id on each ASC tool", async () => {
    const tools: Array<{ name: string; inputSchema: Record<string, any>; annotations: { readOnlyHint: boolean } }> = [];
    let cursor: string | undefined;
    do {
      const { body } = await rpc(test.app, "tools/list", cursor ? { cursor } : {});
      tools.push(...body.result.tools);
      cursor = body.result.nextCursor;
    } while (cursor);
    expect(tools).toHaveLength(22 + 4 + operations.length);
    expect(new Set(tools.map((tool) => tool.name)).size).toBe(tools.length);
    for (const alias of ["list_connections", ...ascTools.map((tool) => tool.name)]) expect(tools.some((tool) => tool.name === alias)).toBe(true);
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
      if (!["list_connections", "asc_find_operations", "asc_describe_operation"].includes(tool.name)) expect(tool.inputSchema.properties.connection_id).toBeDefined();
    }
    const generated = new Map(tools.map((tool) => [tool.name, tool]));
    for (const operation of operations) expect(generated.get(operation.name)!.annotations.readOnlyHint).toBe(operation.method === "GET");
  });
});

describe("tool requests", () => {
  it("list_builds filters by app, newest first", () => {
    expect(requestFor("list_builds", { app_id: "123", pre_release_version: "2.3.0", limit: 5 })).toEqual({
      method: "GET",
      path: "/v1/builds",
      query: { "filter[app]": "123", "filter[preReleaseVersion.version]": "2.3.0", sort: "-uploadedDate", limit: 5 },
    });
  });

  it("list_customer_reviews maps has_response to exists[publishedResponse] and escapes the id", () => {
    const request = requestFor("list_customer_reviews", { app_id: "1/2", has_response: false, rating: 1 });
    expect(request.path).toBe("/v1/apps/1%2F2/customerReviews");
    expect(request.query).toEqual({ "filter[rating]": 1, "exists[publishedResponse]": "false", sort: "-createdDate" });
  });

  it("asc_get asks for a scoped token and passes the query through", () => {
    expect(requestFor("asc_get", { path: "/v1/apps/1/appInfos", query: { include: "app" } })).toEqual({
      method: "GET",
      path: "/v1/apps/1/appInfos",
      query: { include: "app" },
      scoped: true,
    });
  });

  it("list_ci_build_runs takes exactly one of product_id and workflow_id", () => {
    expect(requestFor("list_ci_build_runs", { workflow_id: "w" }).path).toBe("/v1/ciWorkflows/w/buildRuns");
    expect(requestFor("list_ci_build_runs", { product_id: "p" }).path).toBe("/v1/ciProducts/p/buildRuns");
    expect(rejects("list_ci_build_runs", {})).toBe(true);
    expect(rejects("list_ci_build_runs", { product_id: "p", workflow_id: "w" })).toBe(true);
  });

  it("set_what_to_test updates by localization id or creates by build and locale", () => {
    expect(requestFor("set_what_to_test", { localization_id: "l", whats_new: "Try login" })).toEqual({
      method: "PATCH",
      path: "/v1/betaBuildLocalizations/l",
      body: { data: { type: "betaBuildLocalizations", id: "l", attributes: { whatsNew: "Try login" } } },
    });
    expect(requestFor("set_what_to_test", { build_id: "b", locale: "en-US", whats_new: "Try login" })).toMatchObject({
      method: "POST",
      path: "/v1/betaBuildLocalizations",
      body: { data: { relationships: { build: { data: { type: "builds", id: "b" } } } } },
    });
    expect(rejects("set_what_to_test", { build_id: "b", whats_new: "x" })).toBe(true);
    expect(rejects("set_what_to_test", { localization_id: "l", locale: "en-US", whats_new: "x" })).toBe(true);
  });

  it("reply_to_review posts a response linked to the review", () => {
    expect(requestFor("reply_to_review", { review_id: "r1", response_body: "Thanks!" })).toEqual({
      method: "POST",
      path: "/v1/customerReviewResponses",
      body: {
        data: {
          type: "customerReviewResponses",
          attributes: { responseBody: "Thanks!" },
          relationships: { review: { data: { type: "customerReviews", id: "r1" } } },
        },
      },
    });
  });

  it("update_version_localization needs at least one field", () => {
    expect(rejects("update_version_localization", { localization_id: "l" })).toBe(true);
    expect(JSON.parse(JSON.stringify(requestFor("update_version_localization", { localization_id: "l", keywords: "a,b" }).body))).toEqual({
      data: { type: "appStoreVersionLocalizations", id: "l", attributes: { keywords: "a,b" } },
    });
  });

  it("add_testers_to_group sends tester linkages", () => {
    expect(requestFor("add_testers_to_group", { group_id: "g", tester_ids: ["t1", "t2"] }).body).toEqual({
      data: [
        { type: "betaTesters", id: "t1" },
        { type: "betaTesters", id: "t2" },
      ],
    });
  });

  it("rejects limits above 200 and unknown arguments", () => {
    expect(rejects("list_apps", { limit: 201 })).toBe(true);
    expect(rejects("list_apps", { bundleId: "com.example" })).toBe(true);
  });
});

const connection = (id: string, orgId = "org_acme") =>
  ({ id: id as ConnectionId, orgId: orgId as OrgId, name: `Key ${id}` }) as Connection;

describe("resolveConnection", () => {
  it("uses the only connection when none is named", () => {
    expect(resolveConnection([connection("a")])).toEqual({ ok: true, connection: connection("a") });
  });

  it("reports no_connections when there are none", () => {
    expect(resolveConnection([])).toEqual({ ok: false, reason: "no_connections" });
  });

  it("reports ambiguous with every candidate when several exist and none is named", () => {
    const all = [connection("a"), connection("b", "org_other")];
    expect(resolveConnection(all)).toEqual({ ok: false, reason: "ambiguous", candidates: all });
  });

  it("picks the named connection, or reports not_found", () => {
    const all = [connection("a"), connection("b")];
    expect(resolveConnection(all, "b")).toEqual({ ok: true, connection: connection("b") });
    expect(resolveConnection(all, "c")).toEqual({ ok: false, reason: "not_found", connectionId: "c" });
    expect(resolveConnection([], "c")).toEqual({ ok: false, reason: "not_found", connectionId: "c" });
  });
});

describe("compactBody", () => {
  it("keeps data, included, links.next, and meta.paging, and drops link noise", () => {
    const body = {
      data: [
        {
          type: "apps",
          id: "1",
          attributes: { name: "App" },
          relationships: {
            builds: { links: { self: "s", related: "r" } },
            appInfos: { data: [{ type: "appInfos", id: "9" }], links: { self: "s" } },
          },
          links: { self: "https://api.appstoreconnect.apple.com/v1/apps/1" },
        },
      ],
      included: [{ type: "appInfos", id: "9", attributes: {}, links: { self: "s" } }],
      links: { self: "self", next: "https://api.appstoreconnect.apple.com/v1/apps?cursor=x" },
      meta: { paging: { total: 3, limit: 1 } },
    };
    expect(compactBody(body)).toEqual({
      data: [
        {
          type: "apps",
          id: "1",
          attributes: { name: "App" },
          relationships: { appInfos: { data: [{ type: "appInfos", id: "9" }] } },
        },
      ],
      included: [{ type: "appInfos", id: "9", attributes: {} }],
      links: { next: "https://api.appstoreconnect.apple.com/v1/apps?cursor=x" },
      meta: { paging: { total: 3, limit: 1 } },
    });
  });

  it("passes Xcode metrics JSON through untouched", () => {
    const metrics = { version: "1.0", productData: [{ metricCategories: [] }] };
    expect(compactBody(metrics)).toBe(metrics);
  });
});
