import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/main.ts"],
  platform: "node",
  format: "esm",
  deps: {
    alwaysBundle: [/^@asc-mcp\//],
  },
});
