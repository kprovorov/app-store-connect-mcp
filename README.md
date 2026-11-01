<img src="assets/icon.svg" width="64" height="64" alt="">

# app-store-connect-mcp

Created in [T3 Code](https://t3.codes).

## Repo layout

This is a pnpm and Turborepo monorepo.

- `apps/web` is the Next.js dashboard on port 3000.
- `apps/api` is the Hono API that `web` calls, on port 8787.
- `apps/mcp` is the Hono MCP server that agents connect to, on port 8788.
- `packages/typescript-config` has the shared `tsconfig` presets: `base.json`, `node.json`, and `nextjs.json`.
- `supabase` is the local Supabase project config.

Internal packages under `packages/*` export their TypeScript source directly with `"exports": { ".": "./src/index.ts" }` and have no build step. Next.js, `tsx`, and Vitest compile that source when an app imports it. For production, `tsdown` in `apps/api` and `apps/mcp` bundles every `@asc-mcp/*` import into `dist/` (`deps.alwaysBundle` in `tsdown.config.ts`). Pin shared dependency versions such as `typescript` and `vitest` in the `catalog` in `pnpm-workspace.yaml`, and reference them as `"catalog:"`.

## Run it

You need Node 26 and pnpm 12. To run Supabase locally, you also need Docker.

```sh
pnpm install
pnpm dev        # web on :3000, api on :8787, mcp on :8788
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm test:db    # RLS integration tests, needs `supabase start` and applied migrations
```

To run one app, filter by package name, for example `pnpm dev --filter=@asc-mcp/api`.

To start the local database, run `supabase start`. Copy `.env.example` to `.env` and fill in the values.

## Database migrations

`packages/db/src/schema.ts` defines the tables and RLS policies. drizzle-kit writes migrations into `supabase/migrations`, and the Supabase CLI applies them. Do not use `drizzle-kit migrate`.

```sh
pnpm --filter @asc-mcp/db db:generate   # after editing schema.ts
pnpm --filter @asc-mcp/db db:migrate    # supabase migration up on the running local stack
supabase db reset                       # or rebuild the local database from every migration
```

drizzle-kit emits no functions or grants. Those live in hand-written migrations made with `pnpm --filter @asc-mcp/db exec drizzle-kit generate --custom --name <name>`. The `app.*` claim helpers must exist before any policy that calls them, so their migration sorts first.

## api

`apps/api` serves the routes in `packages/contracts` on port 8787. `web` calls it with `Authorization: Bearer <Clerk session token>`, and only `WEB_ORIGIN` passes CORS and Clerk's `azp` check.

- `GET /v1/connections` lists the active org's connections.
- `POST /v1/connections` parses the key, calls `GET /v1/apps?limit=1` on App Store Connect, encrypts the `.p8` with `orgId:connectionId` as AAD, and inserts the row.
- `POST /v1/connections/:id/verify` decrypts the stored key and checks it again.
- `DELETE /v1/connections/:id` removes the row.

A session without an active org gets `403 org_required`. RLS decides who may write, so a non-admin gets `403 forbidden` from the database, not from app code. Every error body is the contract's `ApiError`, and `src/errors.ts` maps each failure to its status in one table. Responses never contain the private key or its ciphertext.

`pnpm --filter @asc-mcp/api test` needs no database. `pnpm --filter @asc-mcp/api test:db` runs create, list, verify, and delete against the local Supabase.

## mcp

`apps/mcp` is the MCP server agents connect to, at `MCP_RESOURCE_URL` (locally `http://localhost:8788/mcp`). It speaks stateless Streamable HTTP. `POST /mcp` answers JSON, and `GET` and `DELETE` answer `405`.

Clerk is the OAuth authorization server, and `mcp` is the resource server.

- `GET /.well-known/oauth-protected-resource/mcp` (and the same path without `/mcp`) returns the resource URL and the Clerk issuer, which comes from the publishable key.
- A request without a token gets `401` with `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource/mcp"`. A bad token adds `error="invalid_token"`.
- Tokens are verified as Clerk OAuth access tokens. OAuth tokens carry no org, so `mcp` reads the user's memberships from the Clerk Backend API and caches them for 30 seconds. A tool sees every connection in every org the user belongs to.

Set `MCP_DEV_ACCEPT_SESSION_TOKENS=true` to also accept Clerk session tokens. Then you can call `mcp` with a token from `clerk` or `sessions.getToken` and skip the OAuth flow. It is for local testing only.

```sh
curl -X POST http://localhost:8788/mcp \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

The server does not check the token audience yet. The Clerk instance has no registered MCP resource, so its tokens carry no `aud`, and checking one would reject every token. Once `mcp` has a public https URL, run the Clerk `configure_mcp_server` tool with that URL as `resource_url`. That registers the resource and turns on the audience claim. Then pass `audience: MCP_RESOURCE_URL` to `authenticateRequest` in `apps/mcp/src/auth.ts`.

`src/tools.ts` is the tool catalog. Each tool is a row with an Effect Schema input, MCP annotations, and a pure `toRequest` that returns the App Store Connect method, path, query, and body. `src/registry.ts` adds the optional `connection_id` argument to every tool, picks the connection, decrypts the key, calls Apple, and turns results and errors into tool output. To add a tool, add a row. `asc_get` covers any read the rows do not, with a token scoped to that one request.
