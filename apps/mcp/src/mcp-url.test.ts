import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { presets, type Preset } from "@asc-mcp/contracts/mcp";
import { buildMcpUrl, shellQuote } from "../../web/src/lib/mcp-url";
import { resolveView } from "./tool-views";

const root = "https://mcp.example.com";

describe("dashboard connection URLs", () => {
  it("keeps the default connection and resolves every preset on the MCP server", () => {
    for (const base of [root, `${root}/`]) {
      expect(buildMcpUrl(base, { kind: "default" }, false)).toEqual({ url: base });
    }
    for (const preset of Object.keys(presets) as Preset[]) {
      const result = buildMcpUrl(root, { kind: "preset", preset }, false);
      expect(result.error).toBeUndefined();
      expect(new URL(result.url!).pathname).toBe(`/${preset}`);
      expect(resolveView(new URL(result.url!)).entries.has("list_apps")).toBe(true);
    }
  });

  it("builds checked groups and tool names with the server's filtering behavior", () => {
    const selectedGroups = buildMcpUrl(root, { kind: "groups", groups: ["apps", "testflight"] }, false);
    const grouped = resolveView(new URL(selectedGroups.url!));
    expect(grouped.entries.has("list_apps")).toBe(true);
    expect(grouped.entries.has("add_beta_tester")).toBe(true);
    expect(grouped.entries.has("update_version_localization")).toBe(false);
    expect(new URL(selectedGroups.url!).searchParams.has("tools")).toBe(false);

    const selectedTools = buildMcpUrl(root, { kind: "tools", tools: " list_apps, get_app,list_apps " }, false);
    expect([...resolveView(new URL(selectedTools.url!)).entries.keys()]).toEqual(["get_app", "list_apps"]);
    expect(new URL(selectedTools.url!).searchParams.has("groups")).toBe(false);
  });

  it("enforces read-only access for every selection method", () => {
    for (const selection of [
      { kind: "default" },
      { kind: "preset", preset: "aso" },
      { kind: "groups", groups: ["apps", "testflight"] },
      { kind: "tools", tools: "list_apps,add_beta_tester" },
    ] as const) {
      const result = buildMcpUrl(root, selection, true);
      const view = resolveView(new URL(result.url!));
      expect(view.readOnly).toBe(true);
      expect(view.entries.has("list_apps")).toBe(true);
      expect([...view.entries.values()].every((entry) => entry.definition.annotations?.readOnlyHint)).toBe(true);
    }
  });

  it("does not produce a fallback URL for incomplete or malformed custom selections", () => {
    expect(buildMcpUrl(root, { kind: "groups", groups: [] }, false).url).toBeUndefined();
    for (const tools of ["", " ", "list_apps,", ",get_app", "list_apps,,get_app", "list apps", "list_apps&mode=write"]) {
      const result = buildMcpUrl(root, { kind: "tools", tools }, false);
      expect(result.url).toBeUndefined();
      expect(result.error).toBeTypeOf("string");
    }
  });

  it("keeps a generated URL intact as one shell argument", () => {
    const result = buildMcpUrl(root, { kind: "groups", groups: ["apps", "testflight"] }, true);
    for (const url of [result.url!, "https://mcp.example.com/?tools=app's&mode=readonly"]) {
      expect(execFileSync("/bin/sh", ["-c", `printf '%s' ${shellQuote(url)}`], { encoding: "utf8" })).toBe(url);
    }
  });
});
