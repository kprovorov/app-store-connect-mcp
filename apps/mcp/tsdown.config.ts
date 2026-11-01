import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  platform: "node",
  format: "esm",
  deps: {
    // Internal packages ship TypeScript source, so they must be bundled, never imported at runtime.
    alwaysBundle: [/^@asc-mcp\//],
  },
});
