import {
  ConnectionResponse,
  ListConnectionsResponse,
  VerifyConnectionResponse,
  routes,
} from "@asc-mcp/contracts";
import { type OrgClaims, listConnections } from "@asc-mcp/db";
import { Effect, type ManagedRuntime, Schema } from "effect";
import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { type SessionEnv, toOrgClaims } from "./auth";
import {
  InvalidInput,
  type Services,
  createConnection,
  parseConnectionId,
  removeConnection,
  toDto,
  verifyConnection,
} from "./connections";
import { type ApiFailure, errorResponse, failureResponse } from "./errors";

export interface ApiDeps {
  readonly webOrigin: string;
  /** Sets `session` on the context. Clerk in production, a fake in tests. */
  readonly session: MiddlewareHandler<SessionEnv>;
  readonly runtime: ManagedRuntime.ManagedRuntime<Services, unknown>;
}

type Env = { Variables: SessionEnv["Variables"] & { claims: OrgClaims } };

// Encoding through the contract schema drops any field the contract does not name.
const reply =
  <A, I>(schema: Schema.Codec<A, I>, status: number) =>
  (value: A) =>
    Response.json(Schema.encodeSync(schema)(value), { status });

const guardMessages = {
  unauthenticated: [401, "Sign in to continue"],
  org_required: [403, "Select an organization to continue"],
} as const;

export const makeApp = ({ webOrigin, session, runtime }: ApiDeps) => {
  const run = <A>(effect: Effect.Effect<A, ApiFailure, Services>, onSuccess: (value: A) => Response) =>
    runtime.runPromise(Effect.match(effect, { onFailure: failureResponse, onSuccess }));

  return new Hono<Env>()
    .use("*", cors({ origin: webOrigin, allowHeaders: ["Authorization", "Content-Type"] }))
    .get("/health", (c) => c.json({ ok: true }))
    .use("/v1/*", session)
    .use("/v1/*", async (c, next) => {
      const guard = toOrgClaims(c.var.session);
      if (!guard.ok) {
        const [status, message] = guardMessages[guard.code];
        return errorResponse(status, { code: guard.code, message });
      }
      c.set("claims", guard.claims);
      await next();
    })
    .get(routes.connections, (c) =>
      run(listConnections(c.var.claims), (connections) =>
        reply(ListConnectionsResponse, 200)({ connections: connections.map(toDto) }),
      ),
    )
    .post(routes.connections, (c) =>
      run(
        Effect.tryPromise({
          try: () => c.req.json<unknown>(),
          catch: () => new InvalidInput({ message: "The request body must be JSON" }),
        }).pipe(Effect.flatMap((body) => createConnection(c.var.claims, body))),
        (connection) => reply(ConnectionResponse, 201)({ connection: toDto(connection) }),
      ),
    )
    .post("/v1/connections/:id/verify", (c) =>
      run(
        Effect.flatMap(parseConnectionId(c.req.param("id")), (id) => verifyConnection(c.var.claims, id)),
        reply(VerifyConnectionResponse, 200),
      ),
    )
    .delete("/v1/connections/:id", (c) =>
      run(
        Effect.flatMap(parseConnectionId(c.req.param("id")), (id) => removeConnection(c.var.claims, id)),
        () => new Response(null, { status: 204 }),
      ),
    )
    .notFound(() => errorResponse(404, { code: "not_found", message: "No such route" }))
    .onError((error) => {
      console.error("api: unhandled", error);
      return errorResponse(500, { code: "internal", message: "Something went wrong on our side" });
    });
};

export type AppType = ReturnType<typeof makeApp>;
