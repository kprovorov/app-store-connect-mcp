import type { Preset, ToolGroup } from "@asc-mcp/contracts/mcp";

export type McpSelection =
  | { readonly kind: "default" }
  | { readonly kind: "preset"; readonly preset: Preset }
  | { readonly kind: "groups"; readonly groups: readonly ToolGroup[] }
  | { readonly kind: "tools"; readonly tools: string };

export type McpUrlResult = { readonly url: string; readonly error?: never } | { readonly url?: never; readonly error: string };

export function buildMcpUrl(baseUrl: string, selection: McpSelection, readOnly: boolean): McpUrlResult {
  const url = new URL(baseUrl);
  url.pathname = selection.kind === "preset" ? `/${selection.preset}` : "/";
  url.search = "";
  url.hash = "";

  if (selection.kind === "groups") {
    if (!selection.groups.length) return { error: "Choose at least one group to create your URL." };
    url.searchParams.set("groups", [...new Set(selection.groups)].join(","));
  }
  if (selection.kind === "tools") {
    const tools = selection.tools.split(",").map((tool) => tool.trim());
    if (tools.some((tool) => !/^[a-zA-Z0-9_-]+$/.test(tool))) {
      return { error: "Enter tool names separated by commas, without empty items." };
    }
    url.searchParams.set("tools", [...new Set(tools)].join(","));
  }
  if (readOnly) url.searchParams.set("mode", "readonly");
  if (selection.kind === "default" && !readOnly) return { url: baseUrl };
  return { url: url.href };
}

export const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
