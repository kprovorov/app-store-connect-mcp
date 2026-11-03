import { serve } from "@hono/node-server";
import app, { config, runtime } from "./main";

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close();
    void runtime.dispose().finally(() => process.exit(0));
  });
}
