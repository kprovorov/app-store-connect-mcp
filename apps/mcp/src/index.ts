import { serve } from "@hono/node-server";
import app, { config, runtime } from "../server";

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`mcp listening on http://localhost:${info.port}, resource ${config.resourceUrl}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close();
    void runtime.dispose().finally(() => process.exit(0));
  });
}
