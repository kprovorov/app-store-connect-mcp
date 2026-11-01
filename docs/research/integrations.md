# Integration reference

Verified facts and snippets for the libraries this repo uses. Read this before writing code against them.

## How this was verified

Packages were installed into a scratch dir `/tmp/asc-research` on 2026-11-01. The exact versions were `effect@4.1.1`, `hono@4.13.16`, `@hono/mcp@0.3.5`, `@modelcontextprotocol/sdk@1.32.2`, `@clerk/backend@3.26.5`, `@clerk/hono@0.1.96`, `@clerk/mcp-tools@0.8.0`, `@clerk/nextjs@7.9.23`, `drizzle-orm@0.45.4`, `drizzle-kit@0.31.11`, `postgres@4.0.0`, `@tanstack/react-query@5.105.1`, `next@16.4.3`, `typescript` latest.

Every TypeScript block below was typechecked with `tsc` (`strict: true`, `moduleResolution: "bundler"`, `skipLibCheck: true`) in `/tmp/asc-research/check/`. Blocks marked "ran" were also executed with Node 26. The scratch dir is disposable. Rerun with `cd /tmp/asc-research && node_modules/.bin/tsc -p .` if it still exists.

These labels are used below.

- **Verified** means read in the installed `.d.ts` or dist code, or typechecked.
- **Ran** means executed and the output was observed.
- **Docs** means taken from official docs, not from code.
- **Unverified** means neither. Treat it as a guess until someone checks.

---

## 1. Effect 4.1.1

### Requirements

The `effect` README requires TypeScript 5.9 or newer, Node.js 22.19 or newer, and `strict: true` in `tsconfig.json` (`node_modules/effect/README.md`).

### Where to look first

`effect` ships agent docs inside the package. Read these before guessing an API.

- `node_modules/effect/AGENTS.md` is the style guide (services, errors, Schema, running).
- `node_modules/effect/ai-docs/src/**` holds runnable examples. Useful ones: `01_effect/03_services/01_service.ts`, `01_effect/02_schema/10_schema-basics.ts`, `04_integration/10_managed-runtime.ts` (ManagedRuntime with Hono), `50_http-client/10_basics.ts`, `01_effect/03_services/20_layer-unwrap.ts` (Config inside a Layer).

### Big renames from v3 (verified against installed exports unless marked docs)

| v3 | v4 |
| --- | --- |
| `Context.Tag(id)<Self, Shape>()` | `Context.Service<Self, Shape>()(id)` |
| `Context.GenericTag<T>(id)` | `Context.Service<T>(id)` |
| `Effect.Tag`, `Effect.Service` | `Context.Service<Self, Shape>()(id, { make })`. No auto `.Default` layer. Define `static readonly layer` yourself. `dependencies` option is gone. Use `Layer.provide` (docs: `migration/services.md`). |
| `Effect.Service` static accessors | `MyService.use((s) => s.method())`, or `yield* MyService` in `Effect.gen` |
| `FiberRef` | `Context.Reference` (module `FiberRef` does not exist) |
| `Either` | `Result` (module `Either` does not exist) |
| `Effect.catchAll` | `Effect.catch` (exported as `catch_ as catch`) |
| `Effect.catchAllCause` | `Effect.catchCause` |
| `Effect.catchSome` | `Effect.catchFilter` (docs) |
| `Effect.fork` / `Effect.forkDaemon` | `Effect.forkChild` / `Effect.forkDetach` |
| `@effect/platform` HttpClient | `effect/http` (`HttpClient`, `HttpClientRequest`, `HttpClientResponse`, `FetchHttpClient`) |
| `effect/unstable/http` (4.0 betas) | `effect/http`. No compatibility path (docs: `MIGRATION.md`). |
| `@effect/sql`, `@effect/rpc`, `@effect/cluster`, `@effect/ai` | `effect/sql`, `effect/rpc`, `effect/cluster`, `effect/ai`. Drivers like `@effect/sql-pg` stay separate. |
| `Schema` from `@effect/schema` | `import { Schema } from "effect"` |
| `Schema.decodeUnknown` | `Schema.decodeUnknownEffect` |
| `Schema.decodeUnknownEither` | `Schema.decodeUnknownExit` (also `decodeUnknownResult`, `decodeUnknownOption`, `decodeUnknownPromise`, `decodeUnknownSync`) |
| `Schema.Literal("a", "b")` | `Schema.Literals(["a", "b"])` |
| `Schema.Union(A, B)` | `Schema.Union([A, B])` |
| `Schema.filter(...)`, `Schema.pattern(re)`, `Schema.UUID` | `Schema.check(Schema.isPattern(re))`, `Schema.check(Schema.isUUID())` |
| `Schema.optionalWith(s, { exact: true })` | `Schema.optionalKey(s)` |
| `.annotations({...})` | `.annotate({...})` |
| `JSONSchema.make(schema)` | `Schema.toJsonSchemaDocument(schema)` |
| `ParseResult.ParseError` | `Schema.SchemaError` with `error.issue` (`SchemaIssue`) |
| `Data.TaggedError` for domain errors | `Schema.TaggedError<Self>()(tag, fields)` is what `AGENTS.md` recommends. `Data` still exists. |

`effect/jose` and `effect/crypto` exist in 4.1.1. `effect/jose` signs ES256 JWTs and imports PKCS#8 PEM keys (README). It is marked "unstable APIs" in the README. It is a candidate for the ASC JWT signer, but this doc did not test it against an Apple `.p8` key (unverified).

### Service, Layer, tagged error, Schema, Config, HttpClient

Verified (typechecked) and ran. The source file is `check/effect.ts`.

```ts
import { Config, ConfigProvider, Context, Effect, Layer, ManagedRuntime, Redacted, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"

export const OrgId = Schema.String.pipe(Schema.check(Schema.isPattern(/^org_[A-Za-z0-9]+$/)), Schema.brand("OrgId"))
export type OrgId = typeof OrgId.Type

export const ConnectionId = Schema.String.pipe(Schema.check(Schema.isUUID()), Schema.brand("ConnectionId"))
export type ConnectionId = typeof ConnectionId.Type

export class Connection extends Schema.Class<Connection>("asc/Connection")({
  id: ConnectionId,
  orgId: OrgId,
  name: Schema.NonEmptyString,
  kind: Schema.Literals(["team", "individual"])
}) {}

export class ConnectionNotFound extends Schema.TaggedError<ConnectionNotFound>()("ConnectionNotFound", {
  id: Schema.String
}) {}

export class AscRequestError extends Schema.TaggedError<AscRequestError>()("AscRequestError", {
  cause: Schema.Defect()
}) {}

export class Connections extends Context.Service<Connections, {
  get(id: ConnectionId): Effect.Effect<Connection, ConnectionNotFound>
}>()("asc/Connections") {
  static readonly layer = Layer.effect(
    Connections,
    Effect.gen(function*() {
      const masterKey = yield* Config.Redacted("ENCRYPTION_MASTER_KEY")
      yield* Effect.logDebug("key length", Redacted.value(masterKey).length)
      const get = Effect.fn("Connections.get")(function*(id: ConnectionId) {
        return yield* new ConnectionNotFound({ id })
      })
      return Connections.of({ get })
    })
  )
}

export class Asc extends Context.Service<Asc, {
  listApps(limit: number): Effect.Effect<unknown, AscRequestError>
}>()("asc/Asc") {
  static readonly layer = Layer.effect(
    Asc,
    Effect.gen(function*() {
      const client = (yield* HttpClient.HttpClient).pipe(
        HttpClient.mapRequest(HttpClientRequest.prependUrl("https://api.appstoreconnect.apple.com")),
        HttpClient.filterStatusOk
      )
      const listApps = Effect.fn("Asc.listApps")(function*(limit: number) {
        return yield* client.get("/v1/apps", {
          urlParams: { limit: String(limit) },
          headers: { authorization: "Bearer <jwt>" }
        }).pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Unknown)),
          Effect.mapError((cause) => new AscRequestError({ cause }))
        )
      })
      return Asc.of({ listApps })
    })
  ).pipe(Layer.provide(FetchHttpClient.layer))
}

const ListAppsInput = Schema.Struct({
  connection_id: Schema.optionalKey(ConnectionId),
  limit: Schema.optionalKey(Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: 200 }))))
})
const decodeInput = Schema.decodeUnknownEffect(ListAppsInput)

export const program = Effect.gen(function*() {
  const input = yield* decodeInput({ limit: 5 })
  const connections = yield* Connections
  if (input.connection_id) return yield* connections.get(input.connection_id)
  return input
}).pipe(Effect.catchTag("ConnectionNotFound", (e) => Effect.succeed({ missing: e.id })))

// Edge 1: one-off run with an explicit config provider (tests).
const testConfig = ConfigProvider.layer(ConfigProvider.fromUnknown({ ENCRYPTION_MASTER_KEY: "x".repeat(32) }))
export const run = () => Effect.runPromise(program.pipe(Effect.provide(Connections.layer), Effect.provide(testConfig)))

// Edge 2: long-lived runtime shared by all Hono handlers.
export const runtime = ManagedRuntime.make(Layer.mergeAll(Connections.layer, Asc.layer))
export const handle = () => runtime.runPromise(program)

export const decodeConnection = Schema.decodeUnknownSync(Connection)
```

Running it confirmed these facts.

- `run()` returned `{ limit: 5 }`.
- `decodeConnection` with a bad id threw `SchemaError(Expected a UUID at ["id"])`.
- `Schema.decodeUnknownExit(ListAppsInput)({ limit: 0 })._tag` was `"Failure"`.
- Excess properties are stripped silently by default. Pass `{ onExcessProperty: "error" }` as the second argument of the decode call to reject them (ran).

Config notes follow (verified in `ConfigProvider.d.ts` and `Config.d.ts`).

- Config readers: `Config.String`, `Config.NonEmptyString`, `Config.Redacted`, `Config.URL`, `Config.Port`, `Config.Boolean`, `Config.Int`, `Config.schema(codec, name)`, `Config.withDefault`.
- Providers: `ConfigProvider.fromEnv()`, `ConfigProvider.fromUnknown(obj)`, `ConfigProvider.fromEnvRecord(record)`, `ConfigProvider.fromDotEnv`. Install with `ConfigProvider.layer(provider)`.
- The default provider reads `process.env` (inferred from `fromEnv` being the default, unverified by a run).

ManagedRuntime notes follow (from `ai-docs/src/04_integration/10_managed-runtime.ts`).

- Build one runtime per process. Call `runtime.dispose()` on shutdown.
- Share a memo map across runtimes with `Layer.makeMemoMapUnsafe()` and `ManagedRuntime.make(layer, { memoMap })` if you build more than one.

### JSON Schema from an Effect Schema (for MCP tool inputs)

Verified and ran. `Schema.toJsonSchemaDocument(schema)` returns `{ dialect: "draft-2020-12", schema, definitions }`, not a bare JSON Schema. Sources are `node_modules/effect/dist/Schema.d.ts` (`toJsonSchemaDocument`) and `dist/JsonSchema.d.ts` (`interface Document`).

```ts
import { Schema } from "effect"

const ConnectionIdField = Schema.String.annotate({ identifier: "ConnectionId", description: "ASC connection id" })

const AscGetInput = Schema.Struct({
  connection_id: Schema.optionalKey(ConnectionIdField),
  path: Schema.String.annotate({ description: "ASC API path, e.g. /v1/apps" })
}).annotate({ description: "Read-only GET against App Store Connect" })

const doc = Schema.toJsonSchemaDocument(AscGetInput)
export const inputSchema = { ...doc.schema, $defs: doc.definitions }
```

Observed output (ran).

```json
{"type":"object","properties":{"connection_id":{"$ref":"#/$defs/ConnectionId"},"path":{"type":"string","description":"ASC API path, e.g. /v1/apps"}},"required":["path"],"additionalProperties":true,"description":"Read-only GET against App Store Connect","$defs":{"ConnectionId":{"type":"string","description":"ASC connection id"}}}
```

These rules follow from the output.

- Refs point at `#/$defs/<identifier>`. Spread `doc.schema` and attach `doc.definitions` as `$defs`. Root `type` is `"object"`, which MCP requires.
- Use `Schema.optionalKey` for optional tool arguments. `Schema.optional` renders as `anyOf: [<type>, { "type": "null" }]` (ran). The document describes `Schema.toCodecJson(schema)`, which maps JSON `null` to `undefined`.
- `additionalProperties: true` is the default output. The decoder strips unknown keys unless you pass `onExcessProperty: "error"`.
- JSON Schema output is best-effort. The Effect decoder stays the authority (doc comment on `toJsonSchemaDocument`).
- `Schema.brand` does not change the runtime AST or the JSON Schema (doc comment on `brand`).
- `Schema.toStandardJSONSchemaV1` also exists (`Schema.d.ts` line 1117). It does not help with `McpServer.registerTool`, because that API only accepts Zod (see section 4).

---

## 2. Clerk + Hono (`apps/api`)

### API surface (verified in `node_modules/@clerk/hono/dist/index.d.ts` and `index.mjs`)

- Exports: `clerkMiddleware(options?)`, `getAuth(c, options?)`, types `ClerkHonoVariables`, `ClerkMiddlewareOptions`. Subpath `@clerk/hono/webhooks` exports `verifyWebhook(c)`.
- `clerkMiddleware` reads `CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY` through `hono/adapter`'s `env(c)`. It throws if either is missing. Optional env: `CLERK_MACHINE_SECRET_KEY`, `CLERK_API_URL`, `CLERK_API_VERSION`.
- It calls `authenticateRequest` with `acceptsToken: "any"` and stores a lazy auth function. `getAuth(c, { acceptsToken })` narrows the type afterward.
- It also sets `c.get("clerk")`, a `ClerkClient` for Backend API calls.
- Options pass through to `authenticateRequest`. Useful ones: `authorizedParties` (checks the session token's `azp`), `audience`, `jwtKey` (networkless verification).
- `getAuth(c)` with no options returns `SignedInAuthObject | SignedOutAuthObject`. Signed-in fields: `isAuthenticated: true`, `userId`, `sessionId`, `orgId`, `orgRole`, `orgSlug`, `orgPermissions`, `has()`.
- `orgRole` comes back with the `org:` prefix, such as `org:admin`. Session tokens v2 carry `o.rol = "admin"` and `@clerk/shared` rebuilds `org:${claims.o?.rol}` (verified in `@clerk/shared/dist/jwtPayloadParser.mjs`).
- Pending sessions count as signed out by default (`treatPendingAsSignedOut` defaults to `true` in `@clerk/shared/dist/types/session.d.ts`). With forced org selection, a user who has not picked an org gets `isAuthenticated: false` until they finish the task.

### Snippet (verified)

The source file is `check/api.ts`.

```ts
import { Hono } from "hono"
import { cors } from "hono/cors"
import { clerkMiddleware, getAuth } from "@clerk/hono"

type Vars = { tenant: { userId: string; orgId: string; orgRole: string } }

const app = new Hono<{ Variables: Vars }>()

app.use("*", cors({ origin: ["http://localhost:3000"], allowHeaders: ["authorization", "content-type"] }))
app.use("*", clerkMiddleware({ authorizedParties: ["http://localhost:3000"] }))

app.use("/connections/*", async (c, next) => {
  const auth = getAuth(c)
  if (!auth.isAuthenticated) return c.json({ error: "unauthorized" }, 401)
  if (!auth.orgId || !auth.orgRole) return c.json({ error: "no active organization" }, 403)
  c.set("tenant", { userId: auth.userId, orgId: auth.orgId, orgRole: auth.orgRole })
  await next()
})

const routes = app.get("/connections", (c) => c.json({ orgId: c.get("tenant").orgId }))

export type AppType = typeof routes
export default app
```

`apps/api` needs `CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY`. The web origin goes into `authorizedParties` and CORS.

Cross-origin bearer flow (web sends `Authorization: Bearer <session token>` to api) follows from `authenticateRequest` reading the header. It was not exercised against a live instance (unverified).

---

## 3. Clerk OAuth for MCP (`apps/mcp`)

### `@clerk/mcp-tools@0.8.0` exports (verified in `package.json` and `dist/`)

The subpaths are `./client`, `./feedback`, `./server`, `./next`, `./express`, `./hono`, `./stores`, `./stores/fs`, `./stores/redis`, `./stores/postgres`, `./stores/sqlite`.

- `@clerk/mcp-tools/server`: `generateProtectedResourceMetadata`, `generateClerkProtectedResourceMetadata`, `fetchClerkAuthorizationServerMetadata`, `verifyClerkToken`, `isClerkAuthInfo`, `corsHeaders`.
- `@clerk/mcp-tools/hono`: `protectedResourceHandler`, `protectedResourceHandlerClerk`, `authServerMetadataHandlerClerk`, `mcpAuth(verifyToken)`, `mcpAuthClerk`, `streamableHttpHandler(createServer)`. It augments Hono's `ContextVariableMap` with `mcpAuth: AuthInfo`.
- `@clerk/mcp-tools/feedback`: `submitFeedbackTool({ secretKey })` for `McpServer.registerTool`.
- Peer deps include `@clerk/hono ^0.1.0`, `hono ^4`, `zod`. Runtime dep: `@modelcontextprotocol/sdk ^1.29.0`.

### Pitfalls in the Hono helpers (verified by reading `dist/hono/index.mjs`)

- `streamableHttpHandler` is typed `(createServer: () => McpServer)`. It does not accept the low-level `Server`. We use `Server` for raw JSON Schema, so write the handler yourself (snippet below).
- `mcpAuth`'s 401 emits `WWW-Authenticate: Bearer resource_metadata=https://...` with no quotes. RFC 9728 uses a quoted string. When `verifyToken` returns `undefined`, it returns 401 with no `WWW-Authenticate` header at all. Hand-roll the 401.
- `protectedResourceHandler*` derives `resource` from the request URL. It strips `/.well-known/oauth-protected-resource` from the path. Served at the bare path, it publishes `resource: "https://host/"`, which does not match `https://host/mcp`. Serve it at `/.well-known/oauth-protected-resource/mcp`, or build the metadata from a fixed `MCP_RESOURCE_URL`.
- Deriving URLs from `c.req.url` breaks behind TLS-terminating proxies that forward `http://`. Use a configured `MCP_RESOURCE_URL`.
- `mcpAuthClerk` does not check audience. Audience is checked only if `clerkMiddleware` gets the `audience` option.
- `generateProtectedResourceMetadata` sets `token_introspection_endpoint` to `${fapi}/oauth/token`, which is the token endpoint. Clients ignore it in practice (unverified).

### `@hono/mcp@0.3.5` auth helpers (verified in `dist/auth.mjs`)

`@hono/mcp` does ship auth helpers: `simpleMcpAuthRouter`, `mcpAuthRouter`, `wellKnownRouter`, `bearerAuth`, `ProxyOAuthServerProvider`, and more. Do not use them with Clerk.

- `createOAuthMetadata` hardcodes `authorization_endpoint: <issuer>/authorize` and `token_endpoint: <issuer>/token`. Clerk's endpoints live under `/oauth/`. `simpleMcpAuthRouter({ issuer: fapi })` would publish wrong authorization server metadata.
- `bearerAuth` points `resource_metadata` at `${origin}/.well-known/oauth-protected-resource` with no `/mcp` suffix. `wellKnownRouter` serves the metadata at the suffixed path. The two disagree.

### Well-known routes

- `/.well-known/oauth-protected-resource/mcp` is required. Clerk's Express guide serves it at the `/mcp`-suffixed path (docs: `https://clerk.com/docs/expressjs/guides/ai/mcp/build-mcp-server.md`).
- `/.well-known/oauth-authorization-server` on the MCP host is not required by the current MCP spec when the protected resource metadata names the Clerk issuer (`@clerk/mcp-tools` README, "Authorization server metadata"). Some older clients still request it. If you serve it, pass Clerk's document through `fetchClerkAuthorizationServerMetadata({ publishableKey })` or `authServerMetadataHandlerClerk`. Never synthesize it.
- Both routes must be public. Mount them before any auth middleware.

### Verifying the access token

How `@clerk/backend` verifies OAuth access tokens (verified in `dist/chunk-HUSV4TUB.mjs`, `verifyMachineAuthToken`):

- Opaque tokens start with `oat_`. They are verified by a Backend API call (`idPOAuthAccessToken.verify(token, { audience })`) on every request.
- JWT access tokens (header `typ` of `at+jwt` or `application/at+jwt`) are verified locally against JWKS. The `aud` claim is checked only when `audience` is passed.
- `assertOAuthAudienceClaim` throws when `audience` is set and the token has no `aud`. Do not pass `audience` until `aud_claim_enabled` is on, or every token fails.

The authenticated OAuth auth object has `userId`, `clientId`, `scopes`, `id`, `subject`. It has no org fields. The type `MachineObjectExtendedProperties["oauth_token"]` is `{ userId, clientId }` only (verified in `dist/tokens/authObjects.d.ts`). `IdPOAuthAccessToken` carries `id`, `clientId`, `subject`, `scopes`, `aud`, `act`, timestamps. **A Clerk OAuth access token carries no org claim.** Resolve memberships with the Backend API:

```ts
const memberships = await c.get("clerk").users.getOrganizationMembershipList({ userId, limit: 100 })
const orgIds = memberships.data.map((m) => m.organization.id)
```

`getOrganizationMembershipList(params: { userId } & pagination)` returns `PaginatedResourceResponse<OrganizationMembership[]>` (verified in `dist/api/endpoints/UserApi.d.ts`). The snippet typechecks with `clerk: ClerkClient` from `@clerk/backend`. It was not run against a live instance (unverified at runtime).

### Snippet: protected resource metadata, 401, auth, stateless MCP (verified and ran)

The source file is `check/mcp.ts`.

```ts
import { Hono } from "hono"
import { clerkMiddleware, getAuth } from "@clerk/hono"
import { generateClerkProtectedResourceMetadata, corsHeaders } from "@clerk/mcp-tools/server"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js"
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js"

const MCP_RESOURCE_URL = process.env.MCP_RESOURCE_URL! // https://mcp.example.com/mcp
const PRM_URL = new URL("/.well-known/oauth-protected-resource/mcp", MCP_RESOURCE_URL).href

const app = new Hono<{ Variables: { mcpAuth: AuthInfo } }>()

app.get("/.well-known/oauth-protected-resource/mcp", (c) =>
  c.json(
    generateClerkProtectedResourceMetadata({
      publishableKey: process.env.CLERK_PUBLISHABLE_KEY!,
      resourceUrl: MCP_RESOURCE_URL,
      properties: { scopes_supported: ["profile", "email"] }
    }),
    200,
    corsHeaders
  )
)

const unauthorized = () =>
  new Response(JSON.stringify({ error: "invalid_token" }), {
    status: 401,
    headers: { "content-type": "application/json", "WWW-Authenticate": `Bearer resource_metadata="${PRM_URL}"` }
  })

// Add { audience: MCP_RESOURCE_URL } only after the resource is registered in Clerk (aud claim on).
app.use("/mcp", clerkMiddleware())
app.use("/mcp", async (c, next) => {
  const token = c.req.header("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1]
  if (!token) return unauthorized()
  const auth = getAuth(c, { acceptsToken: "oauth_token" })
  if (!auth.isAuthenticated) return unauthorized()
  c.set("mcpAuth", { token, clientId: auth.clientId, scopes: auth.scopes, extra: { userId: auth.userId } })
  await next()
})

const tools: Array<Tool> = [
  {
    name: "asc_get",
    description: "Read-only GET against the App Store Connect API",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    annotations: { readOnlyHint: true }
  }
]

function createServer() {
  const server = new Server({ name: "asc-mcp", version: "0.0.0" }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const userId = extra.authInfo?.extra?.userId
    if (typeof userId !== "string") return { isError: true, content: [{ type: "text", text: "unauthenticated" }] }
    return { content: [{ type: "text", text: JSON.stringify({ tool: request.params.name, args: request.params.arguments }) }] }
  })
  return server
}

app.all("/mcp", async (c) => {
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  const server = createServer()
  await server.connect(transport)
  try {
    return await transport.handleRequest(c.req.raw, { authInfo: c.get("mcpAuth") })
  } finally {
    await transport.close()
  }
})

export default app
```

Observed results follow (ran, with a fake publishable key for `example.clerk.accounts.dev`).

- `POST /mcp` with no token returned `401` and `WWW-Authenticate: Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"`.
- `POST /mcp` with `Bearer oat_garbage` returned the same 401.
- `GET /.well-known/oauth-protected-resource/mcp` returned `resource: "https://mcp.example.com/mcp"` and `authorization_servers: ["https://example.clerk.accounts.dev"]`.

The `try/finally` close is safe with `enableJsonResponse: true`. The response body was still readable after `transport.close()` (ran, `check/close-run.ts`). With SSE responses, close only after the stream ends, as `@clerk/mcp-tools` does with a `TransformStream` (verified in `dist/hono/index.mjs`).

`apps/mcp` needs `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, and `MCP_RESOURCE_URL`.

### Clerk instance settings MCP clients need

These keys are **not** in `get_instance_config_schema` for `app_3LW5AFDcHj4TUE1UdRirX1ovob6`. That schema has no OAuth-server section, only `connection_oauth_*` SSO providers and `paths.oauth_consent`. The keys below come from the Clerk MCP tool `check_mcp_server`, read on 2026-11-01 for the development instance:

| Key | Current value | Meaning |
| --- | --- | --- |
| `dynamic_oauth_client_registration` | `false` | DCR. Enable only for clients without CIMD support (Clerk Express guide). |
| `client_id_metadata_documents_advertised` | `false` | CIMD. Blocker: "MCP clients cannot register". |
| `aud_claim_enabled` | `false` | Blocker: tokens carry no audience. |
| `oauth_jwt_access_tokens` | `false` | Tokens are opaque `oat_`, so every request costs a Backend API call. |
| `pkce_required` | `true` | Required by CIMD clients (S256). |
| `client_id_metadata_documents_only_allow_pre_registered_clients` | `false` | |
| `client_id_metadata_documents_block_implicitly_allowed_clients` | `false` | |

No MCP server is registered yet. The write path is the Clerk MCP tool `configure_mcp_server({ application_id, instance, resource_url })`. Its description says the first registration also turns on the audience claim and CIMD. Use `dry_run: true` first. The resource URL must be public `https` (plan.md). Nothing was changed by this research.

Org selection config read with `get_instance_config` shows `organization_settings.enabled: true`, `force_organization_selection: true`, `creator_role: "org:admin"`, `slug_disabled: true`.

---

## 4. `@hono/mcp` + MCP SDK 1.32.2

### Facts (verified)

- `@hono/mcp` exports `StreamableHTTPTransport`, `MemoryEventStore`, `streamSSE`, and re-exports auth helpers. `handleRequest(c, parsedBody?)` takes the Hono context.
- `@hono/mcp`'s transport reads auth from `c.get("auth")`, not `c.get("mcpAuth")` (verified in `dist/index.mjs`). `@clerk/mcp-tools` sets `mcpAuth`. Mixing the two silently drops `authInfo`.
- The SDK's `WebStandardStreamableHTTPServerTransport` takes a `Request` plus `{ authInfo, parsedBody }`. It needs no Hono glue. Prefer it.
- Stateless mode is `sessionIdGenerator: undefined`. Create a new `Server` and transport per request.
- `enableJsonResponse: true` returns `application/json`. Without it, the same call returns `text/event-stream` with one `event: message` (ran).
- In stateless mode, `tools/list` and `tools/call` work without a prior `initialize` on the same server instance (ran).
- The low-level `Server` class is marked `@deprecated` in favor of `McpServer`, "Only use `Server` for advanced use cases" (`dist/esm/server/index.d.ts` line 71). It still works.
- `McpServer.registerTool`'s `inputSchema` accepts `ZodRawShapeCompat | AnySchema`, where `AnySchema = z3.ZodTypeAny | z4.$ZodType` (`dist/esm/server/zod-compat.d.ts`). It does not accept raw JSON Schema or Standard Schema. Raw JSON Schema needs `Server` plus `setRequestHandler`.
- `RequestHandlerExtra` carries `authInfo?: AuthInfo`, `signal`, `sessionId?`, `requestId`, `requestInfo?` (`dist/esm/shared/protocol.d.ts`).
- `AuthInfo` is `{ token, clientId, scopes, expiresAt?, resource?, extra? }` (`dist/esm/server/auth/types.d.ts`). Put the user id in `extra`.
- The transport also has `allowedHosts`, `allowedOrigins`, `enableDnsRebindingProtection` options.

### `@hono/mcp` variant (verified and ran)

Use this only if you want `@hono/mcp`'s lenient `Accept` handling (`strictAcceptHeader: false` is the default).

```ts
const app = new Hono<{ Variables: { auth: AuthInfo } }>()
app.all("/mcp", async (c) => {
  const server = createServer()
  const transport = new StreamableHTTPTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  await server.connect(transport)
  return transport.handleRequest(c)
})
```

A tool call returned `extra.authInfo.extra` as `{"userId":"user_1"}` after a middleware did `c.set("auth", authInfo)` (ran).

---

## 5. Drizzle + Supabase RLS

### `drizzle-orm/supabase` exports (verified in `drizzle-orm/supabase/rls.d.ts` and `rls.js`)

- Roles, all `.existing()`: `anonRole`, `authenticatedRole`, `serviceRole`, `postgresRole` (named `postgres_role`), `supabaseAuthAdminRole`.
- Tables: `authUsers` (`auth.users`), `realtimeMessages`.
- SQL: `authUid` is `sql\`(select auth.uid())\``. `realtimeTopic` is `sql\`realtime.topic()\``.

**Do not use `authUid` or `auth.uid()` here.** Supabase's `auth.uid()` returns the `sub` claim cast to `uuid` (Supabase auth migration `20220224000811_update_auth_functions.up.sql`, docs summary). Clerk ids look like `user_2abc...`, so the cast raises an error. Use `auth.jwt() ->> 'sub'`, as Supabase's Clerk guide does (docs: `https://supabase.com/docs/guides/auth/third-party/clerk`).

### Table with policies (verified, and `drizzle-kit generate` ran)

`pgTable(...).enableRLS()` exists in 0.45.4 (`pg-core/table.d.ts`). The Drizzle docs site now shows `pgTable.withRLS(...)`. That is the v1 beta API and does not exist in 0.45.4. Adding any `pgPolicy` enables RLS automatically (docs: `https://orm.drizzle.team/docs/rls`).

`PgPolicyConfig` is `{ as?: "permissive" | "restrictive"; for?: "all" | "select" | "insert" | "update" | "delete"; to?; using?: SQL; withCheck?: SQL }`.

```ts
import { sql } from "drizzle-orm"
import { index, pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { authenticatedRole } from "drizzle-orm/supabase"

const jwtOrgId = sql`(select auth.jwt() ->> 'org_id')`
const jwtOrgIds = sql`(select coalesce(auth.jwt() -> 'org_ids', '[]'::jsonb))`

export const ascConnections = pgTable(
  "asc_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull(),
    name: text("name").notNull(),
    keyId: text("key_id").notNull(),
    issuerId: text("issuer_id"),
    privateKeyCiphertext: text("private_key_ciphertext").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index("asc_connections_org_id_idx").on(t.orgId),
    pgPolicy("org members read", {
      for: "select",
      to: authenticatedRole,
      using: sql`${t.orgId} = ${jwtOrgId} or ${jwtOrgIds} ? ${t.orgId}`
    }),
    pgPolicy("org members insert", { for: "insert", to: authenticatedRole, withCheck: sql`${t.orgId} = ${jwtOrgId}` }),
    pgPolicy("org admins delete", {
      for: "delete",
      to: authenticatedRole,
      using: sql`${t.orgId} = ${jwtOrgId} and (select auth.jwt() ->> 'org_role') = 'org:admin'`
    })
  ]
).enableRLS()
```

`drizzle-kit generate` produced this SQL (ran, no database needed):

```sql
ALTER TABLE "asc_connections" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org members read" ON "asc_connections" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("asc_connections"."org_id" = (select auth.jwt() ->> 'org_id') or (select coalesce(auth.jwt() -> 'org_ids', '[]'::jsonb)) ? "asc_connections"."org_id");
```

The SQL also contained `CREATE TABLE`, `CREATE INDEX`, the insert and delete policies, and `--> statement-breakpoint` comment lines. drizzle-kit also writes `supabase/migrations/meta/` (journal and snapshots). Whether the Supabase CLI ignores that subdirectory is unverified.

drizzle-kit emits no `GRANT`. Existing Supabase projects auto-grant `select, insert, update, delete` on new `public` tables to `anon`, `authenticated`, and `service_role`. Supabase is moving the platform default to revoke those automatic grants (docs: `https://supabase.com/docs/guides/api/securing-your-api`, "Default privileges for new tables and functions"). Do not rely on either default. Add explicit grants in a hand-written migration (`drizzle-kit generate --custom`), for example `grant select, insert, delete on table public.asc_connections to authenticated;`. Whether the local CLI 2.122.0 stack still auto-grants is unverified.

### drizzle-kit config (verified in `drizzle-kit/index.d.ts`)

`migrations.prefix` accepts `"index" | "timestamp" | "supabase" | "unix" | "none"`. `entities.roles` accepts `boolean | { provider?: "supabase" | "neon" | string }`.

```ts
import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./supabase/migrations",
  migrations: { prefix: "supabase" },
  entities: { roles: { provider: "supabase" } },
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres" }
})
```

The `supabase` prefix produced `20261101182543_same_paper_doll.sql` (ran). That matches Supabase's `<timestamp>_<name>.sql` naming. Apply migrations with the Supabase CLI (`supabase db reset` or `supabase migration up`), not `drizzle-kit migrate`.

### RLS client: run each request as `authenticated` (verified, not run against a database)

Drizzle's documented Supabase `createDrizzle` wraps `client.transaction` and runs `set_config('request.jwt.claims', ...)` plus `set local role ...` built with `sql.raw` string interpolation (docs: `https://orm.drizzle.team/docs/rls`). Do not copy the `sql.raw` part. Interpolating claims is injection-prone. Use a bound parameter:

```ts
import { sql } from "drizzle-orm"
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "./schema"

type Claims = { sub: string; org_id?: string; org_role?: string; org_ids?: ReadonlyArray<string> }
type Db = PostgresJsDatabase<typeof schema>
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]

export function createDb(url: string) {
  const client = postgres(url, { prepare: false })
  const db = drizzle({ client, schema })
  const withClaims = <A>(claims: Claims, fn: (tx: Tx) => Promise<A>) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('request.jwt.claims', ${JSON.stringify({ ...claims, role: "authenticated" })}, true)`)
      await tx.execute(sql`set local role authenticated`)
      return fn(tx)
    })
  return { db, withClaims, close: () => client.end() }
}
```

Notes follow.

- `set_config(..., true)` and `set local` both reset at transaction end. A `finally` reset is not needed.
- `set local role` cannot take a bind parameter. Keep the role a literal.
- `prepare: false` is required behind Supavisor in transaction mode (port 6543) per the postgres.js README. It is harmless on a direct connection.
- The `postgres` user can `set role authenticated` on local Supabase. That `postgres` is a member of `authenticated` on hosted Supabase is believed true but unverified.

### drizzle-orm 0.45.4 with `postgres@4`

Facts:

- drizzle-orm's peer range is `postgres: ">=3"`, so v4 installs without warnings.
- The runtime calls drizzle makes all exist in postgres 4.0.0: default import `postgres`, `client.options.parsers[oid] = fn` and `client.options.serializers[oid] = fn`, `client.unsafe(query, params, { prepare })`, `.values()`, `client.begin(cb)`, `tx.savepoint(cb)`. Sources: `drizzle-orm/postgres-js/driver.js` and `session.js`, `postgres/src/index.js`.
- In v4, `options.parsers` and `options.serializers` are a `Proxy` with only a `get` trap. Drizzle's assignments land on the underlying object that `parser(oid)` reads (`postgres/src/index.js` `view`, `src/types.js`). The overrides work by reading. Not run.
- With `skipLibCheck: false`, `tsc` reports `drizzle-orm/postgres-js/session.d.ts(56,32): Type 'TransactionSql' does not satisfy the constraint 'Sql'`. v4's `TransactionSql` no longer extends `Sql`. It is hidden by `skipLibCheck: true`, which drizzle needs anyway.
- `drizzle-kit generate` ran with v4 installed. drizzle-kit loads postgres with `await import("postgres")` and `postgres.default(...)`, which works with v4's ESM. drizzle-kit prefers `pg` if both are installed.
- v4 behavior changes (postgres README, "Upgrading from v3"): the server decides parameter types, `sql.array()` is removed, transactions are stricter, and `timestamp` (without zone) columns read as UTC.
- No live query, `drizzle-kit migrate`, or `push` ran against v4 (unverified).

Pin `postgres@^3.4` for now. Drizzle 0.45 was built and typed against v3, and v4 buys this project nothing. If you take v4, keep `skipLibCheck: true`, use `timestamptz` columns only, and run the RLS script against a real database before trusting it.

---

## 6. Clerk + Next.js 16 (`apps/web`)

### Conventions (verified)

- Next 16 renames `middleware.ts` to `proxy.ts`. The `middleware` export name is deprecated. Proxy runs on the Node.js runtime only. Setting `runtime` in a proxy file throws (`next/dist/docs/01-app/02-guides/upgrading/version-16.md`, `.../file-conventions/proxy.md`).
- Clerk's file contents are the same for either name. `export default clerkMiddleware(...)` from `@clerk/nextjs/server` (docs: Clerk Next.js quickstart).
- `ClerkProvider` goes inside `<body>` (docs: Clerk Next.js quickstart).
- Clerk Core 3 (`@clerk/nextjs@7`) removed `<SignedIn>`, `<SignedOut>`, `<Protect>`. They still export, but their type is `never` and rendering throws (verified in `@clerk/nextjs/dist/types/removedControlComponents.d.ts`). Use `<Show when="signed-in">`, `<Show when="signed-out">`, `<Show when={{ role: "org:admin" }}>`. Wrap `<Show>` in `<Suspense>` (docs).
- **The Clerk MCP `b2b-saas` snippet bundle is stale.** It still shows `SignedIn`, `SignedOut`, `Protect`, and `middleware.ts`. Trust the installed typings over it.
- `@clerk/nextjs` exports `TaskChooseOrganization`, `OrganizationSwitcher`, `OrganizationList`, `CreateOrganization`, `useAuth`, `useOrganization`, `useOrganizationList`, `Show`, `ClerkProvider` (`dist/types/index.d.ts`).
- `apps/web` needs `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` (docs).

### Forced org selection (session tasks)

- `SessionTask["key"]` is `"choose-organization" | "reset-password" | "setup-mfa"` (`@clerk/shared/dist/types/session.d.mts`).
- `ClerkProvider` accepts `taskUrls?: Partial<Record<SessionTask["key"], string>>` (`@clerk/shared/dist/types/clerk.d.mts`). Without `taskUrls` or `navigate`, Clerk logs "Session has pending tasks but no handling is configured" and users can get stuck (`internal/clerk-js/sessionTasks.mjs`).
- Pending sessions are signed out by default everywhere. `auth()` and `useAuth()` return `userId: null`, `orgId: null` until the task is done (docs: `https://clerk.com/docs/guides/configure/session-tasks.md`). Pass `{ treatPendingAsSignedOut: false }` to read the user id of a pending session.

### Snippets (verified)

The source files are in `check/web/`.

`proxy.ts`:

```ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server"

const isPublicRoute = createRouteMatcher(["/", "/sign-in(.*)", "/sign-up(.*)"])

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) await auth.protect()
})

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)"
  ]
}
```

`app/layout.tsx`:

```tsx
import { ClerkProvider, OrganizationSwitcher, Show, SignInButton, UserButton } from "@clerk/nextjs"
import { Suspense, type ReactNode } from "react"

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ClerkProvider taskUrls={{ "choose-organization": "/session-tasks/choose-organization" }}>
          <header>
            <Suspense>
              <Show when="signed-out">
                <SignInButton />
              </Show>
              <Show when="signed-in">
                <OrganizationSwitcher hidePersonal afterSelectOrganizationUrl="/connections" />
                <UserButton />
              </Show>
            </Suspense>
          </header>
          {children}
        </ClerkProvider>
      </body>
    </html>
  )
}
```

`app/session-tasks/choose-organization/page.tsx`:

```tsx
import { TaskChooseOrganization } from "@clerk/nextjs"

export default function Page() {
  return <TaskChooseOrganization redirectUrlComplete="/connections" />
}
```

Calling `apps/api` from the client with the session token, Hono RPC, and React Query:

```tsx
"use client"
import { useAuth } from "@clerk/nextjs"
import { useQuery } from "@tanstack/react-query"
import { hc } from "hono/client"
import type { AppType } from "@repo/api"

export function useApi() {
  const { getToken } = useAuth()
  return hc<AppType>(process.env.NEXT_PUBLIC_API_URL!, {
    headers: async (): Promise<Record<string, string>> => {
      const token = await getToken()
      return token ? { authorization: `Bearer ${token}` } : {}
    }
  })
}

export function useConnections() {
  const { orgId } = useAuth()
  const api = useApi()
  return useQuery({
    queryKey: ["connections", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const res = await api.connections.$get()
      if (!res.ok) throw new Error(`api ${res.status}`)
      return res.json()
    }
  })
}
```

Notes follow.

- `getToken()` returns the session token for the active org. `GetTokenOptions` also accepts `organizationId`, `template`, `skipCache` (`@clerk/shared/dist/types/session.d.mts`).
- Put `orgId` in the query key so switching orgs refetches.
- `hc`'s `headers` option accepts an async function (typechecked).

---

## 7. Supabase local

### Ports (verified)

From `supabase init` with Supabase CLI 2.122.0 (`supabase/config.toml`), which match the docs:

| Service | Port |
| --- | --- |
| API gateway (REST, Auth, Storage, Realtime) | 54321 |
| Postgres | 54322 |
| Shadow DB (diffs) | 54320 |
| Studio | 54323 |
| Mailpit (Inbucket replacement) | 54324 |
| Pooler (disabled by default) | 54329 |

- The Postgres major version is 17.
- The local DB URL is `postgresql://postgres:postgres@127.0.0.1:54322/postgres` (docs, Supabase CLI getting started).

### `authenticated` role and `auth.jwt()` from a direct connection

- `auth.jwt()` reads `current_setting('request.jwt.claims', true)` as `jsonb`. `auth.uid()` reads `sub` from the same setting and casts it to `uuid`. Both read session settings, not PostgREST, so they work on a direct connection once the setting is set. Supabase's own RLS testing docs use exactly this: `SET request.jwt.claims = '{"sub": "...", "role": "authenticated"}'` (docs: `https://supabase.com/docs/guides/auth/oauth-server/token-security`, "Testing your policies").
- RLS applies to `authenticated` because that role lacks `bypassrls`. The `postgres` role bypasses policies on tables it owns, which is why the role switch matters (plan.md decision). The `bypassrls` attributes are from Supabase convention (unverified locally).
- Nothing here was run against a local Supabase stack. The scripted RLS test in the plan's "Done means" item 2 is the real check.

---

## Gotchas most likely to bite

1. Clerk OAuth access tokens carry no org claim. Resolve orgs with `users.getOrganizationMembershipList`.
2. `auth.uid()` and drizzle's `authUid` cast `sub` to `uuid`. Clerk ids break them. Use `auth.jwt() ->> 'sub'`.
3. Passing `audience` to `clerkMiddleware` before the MCP resource is registered rejects every token. Registration turns on `aud_claim_enabled`.
4. Serve protected resource metadata at `/.well-known/oauth-protected-resource/mcp` with `resource` set from a fixed `MCP_RESOURCE_URL`.
5. `@clerk/mcp-tools` Hono helpers need `McpServer`, emit an unquoted `resource_metadata`, and skip `WWW-Authenticate` on bad tokens. Hand-roll the 401.
6. `@hono/mcp`'s auth routers publish `/authorize` and `/token`, which are wrong for Clerk. Its transport reads `c.get("auth")`.
7. `McpServer.registerTool` only takes Zod. Raw JSON Schema from Effect needs the low-level `Server`.
8. `Schema.toJsonSchemaDocument` returns `{ schema, definitions }`. Merge `definitions` into `$defs`. Use `Schema.optionalKey` or optional args render as `anyOf [T, null]`.
9. Clerk Core 3 removed `SignedIn`, `SignedOut`, `Protect`. Clerk's own `b2b-saas` snippet still uses them.
10. drizzle 0.45 with `postgres@4` has a type mismatch and no live test. Pin `postgres@^3.4`.
11. drizzle-kit emits no `GRANT`, and Supabase is moving to revoke automatic grants on new `public` tables. Grant `authenticated` explicitly in a custom migration.
