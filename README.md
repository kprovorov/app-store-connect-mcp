<img src="assets/icon.svg" width="64" height="64" alt="">

# app-store-connect-mcp

Created in [T3 Code](https://t3.codes).

## Connect to the hosted server

1. Sign in at [app.ascmcp.dev](https://app.ascmcp.dev), choose an organization, and add an App Store Connect API key with the minimum Apple role you need.
2. In your agent's remote MCP settings, add `https://mcp.ascmcp.dev` and complete the Clerk OAuth sign-in using the same account. The dashboard includes instructions for Claude Code, Cursor, VS Code, and Claude.ai.
3. Ask the agent to call `list_connections` and `list_apps`. If several connections are visible, pass the desired `connection_id`.

The server exposes 28 MCP tools. The existing 22 convenience tools remain, with six tools for API discovery, read and write execution, and uploads. All 1,303 operations in Apple's pinned App Store Connect API 4.5.1 specification are available through the read and write executors. Screenshot uploads use Apple's current asset library. Binary reports return bounded base64 resources.

Every organization member can use that organization's stored keys, including write operations allowed by the Apple key. Server operators can decrypt stored keys. Read [SECURITY.md](SECURITY.md) before uploading credentials. For your own deployment, follow the setup below and use your own Clerk and database instances.

## Repo layout

This is a pnpm and Turborepo monorepo.

- `apps/landing` is the Next.js landing page on port 3001. It is static and links to `web` for sign-in.
- `apps/web` is the Next.js dashboard on port 3000. The dashboard is at `/`, next to `/sign-in`, `/sign-up`, and `/choose-organization`.
- `apps/api` is the Hono API that `web` calls, on port 8787.
- `apps/mcp` is the Hono MCP server that agents connect to, on port 8788.
- `packages/typescript-config` has the shared `tsconfig` presets: `base.json`, `node.json`, and `nextjs.json`.
- `supabase` is the local Supabase project config.

Internal packages under `packages/*` export their TypeScript source directly with `"exports": { ".": "./src/index.ts" }` and have no build step. Next.js, `tsx`, and Vitest compile that source when an app imports it. For production, `tsdown` in `apps/api` and `apps/mcp` bundles every `@asc-mcp/*` import into `dist/` (`deps.alwaysBundle` in `tsdown.config.ts`). Pin shared dependency versions such as `typescript` and `vitest` in the `catalog` in `pnpm-workspace.yaml`, and reference them as `"catalog:"`.

## Run it

You need Node 26 and pnpm 12. To run Supabase locally, you also need Docker.

```sh
pnpm install
pnpm dev        # landing on :3001, web on :3000, api on :8787, mcp on :8788
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm test:db    # RLS integration tests, needs `supabase start` and applied migrations
```

To run one app, filter by package name, for example `pnpm dev --filter=@asc-mcp/api`.

To start the local database, run `supabase start`. Copy `.env.example` to `.env` and fill in development values. Generate the development encryption key with `pnpm --filter @asc-mcp/crypto gen-key`.

The Next.js apps read their own `.env.local`. Copy `apps/web/.env.example` and `apps/landing/.env.example` to `.env.local` in the same directories. Use one Clerk development instance for both web and the backend. See [CONTRIBUTING.md](CONTRIBUTING.md) for organization/OAuth setup and checks. Never point integration tests at production.

CI runs type checks, lint, unit tests, builds, dependency audit, an isolated PostgreSQL 17 integration suite, and a full-history Gitleaks scan. Builds fetch Google Fonts. [Dependency security notes](docs/dependency-security.md) describe remaining tooling advisories.

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

`apps/mcp` is the MCP server agents connect to, at the domain root: `https://mcp.ascmcp.dev` (locally `http://localhost:8788`). It speaks stateless Streamable HTTP. `POST /` answers JSON, and authenticated `GET /` and `DELETE /` answer `405`.

Clerk is the OAuth authorization server, and `mcp` is the resource server.

- `GET /.well-known/oauth-protected-resource` returns the resource URL and the Clerk issuer, which comes from the publishable key.
- A request without a token gets `401` with `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource", scope="profile email"`. A bad token adds `error="invalid_token"`. The scope hint and metadata share the same scope list.
- Tokens are verified as Clerk OAuth access tokens. OAuth tokens carry no org, so `mcp` reads the user's memberships from the Clerk Backend API and caches them for 30 seconds. A tool sees every connection in every org the user belongs to.

Set `MCP_DEV_ACCEPT_SESSION_TOKENS=true` to also accept Clerk session tokens. Then you can call `mcp` with a token from `clerk` or `sessions.getToken` and skip the OAuth flow. It is for local testing only.

```sh
curl -X POST http://localhost:8788 \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

The server checks that each token's audience is `MCP_RESOURCE_URL`. Clerk only sets that audience after the resource is registered. Set `MCP_RESOURCE_URL`, the web app's `NEXT_PUBLIC_MCP_URL`, and Clerk's `resource_url` to exactly `https://mcp.ascmcp.dev`. Resource identifiers are preserved as configured: adding a trailing slash changes the OAuth audience. Some clients still send it: Claude Code requests `resource=https://mcp.ascmcp.dev/`. So Clerk registers both spellings, and the server accepts a token for either one. Rejected tokens are logged with Clerk's reason, never the token. Locally there is no https URL, so set `MCP_ENFORCE_AUDIENCE=false`. Session tokens have no audience either, so the dev session-token flag needs it off too.

`src/tools.ts` retains the existing convenience tools. `src/generated/operations.json` is the internal catalog of Apple operations and their argument schemas. `src/operations.ts` validates catalog requests against those schemas. `src/registry.ts` selects a visible connection, decrypts its key, and calls Apple. Catalog reads use request-scoped tokens. Apple API key roles still determine which operations succeed.

`tools/list` returns all 28 tools in one response. It does not advertise individual API endpoints as tools. `asc_find_operations` searches the internal catalog and returns Apple operation IDs. `asc_describe_operation` accepts an operation ID and returns its arguments schema and the execution tool to use.

Call `asc_read_operation` for GET or `asc_write_operation` for mutations. Supply `operation` with the Apple operation ID, `arguments` matching the described schema, and an optional outer `connection_id`.

Operation arguments keep Apple's parameter and JSON:API field names. For example, call `asc_read_operation` with:

```json
{"operation":"apps_getInstance","arguments":{"path":{"id":"123"},"query":{"fields[apps]":["name","bundleId"]}},"connection_id":"connection-a"}
```

Writes pass the original JSON:API request under `arguments.body`. The `accept` argument selects among response media types when Apple offers a choice. Deprecated operations remain callable and discovery marks them as deprecated. The catalog covers the App Store Connect specification. App Store Server API, Transporter, and website-only actions are separate interfaces.

See [the pinned specification](apps/mcp/spec/README.md) for provenance and regeneration commands.

### Upload a screenshot

1. Use `list_app_store_versions` and `list_version_localizations` to find the target localization.
2. Find `appAssetLibraryRefData_getCollection` with `asc_find_operations` and read its schema. Use its reference data to select the supported image dimensions and `placement_group` for `APP_SCREENSHOT`.
3. Call `upload_screenshot` with the target and one file source:

```json
{"app_id":"123","localization_id":"locale-a","placement_group":"IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE","file_name":"home.png","content_base64":"<canonical base64>","wait_seconds":0,"connection_id":"connection-a"}
```

Inline files support at most 2 MiB decoded. For larger files, replace `content_base64` with `source_url`. Source URLs must use a public HTTPS hostname on port 443, return the file directly without redirects, and contain at most 20 MiB. The server pins a public DNS address, verifies TLS for the original hostname, and forwards no credentials. Local filesystem paths are not accepted by the hosted server.

A successful result has `state: "placed"`, `image_id`, and `placement_id`. If processing is still pending, the result has `state: "processing"`. Call `upload_screenshot` again with the same target and `image_id`, without file fields. Continuation verifies that the image belongs to the app's library and reuses an existing matching placement. Errors retain the stage and image ID after reservation, so an agent can inspect or repair the reservation with the generated operations. A transfer failure requires re-upload through `upload_asset` or a new reservation. `upload_screenshot` continuation handles processing and placement only.

An image still in `AWAITING_UPLOAD` returns a commit-stage error with recovery arguments. Complete any unfinished transfer with `upload_asset`, then call `appAssetLibraryImages_updateInstance` with `uploaded: true`. Only committed images in `UPLOAD_COMPLETE` are reported as processing. Resume `upload_screenshot` after the commit succeeds.

The tool preserves existing screenshots. To set their display order, find `appAssetLibraryPlacementOrderingRequests_createInstance` and use the schema returned by `asc_describe_operation`. Its body identifies the localization and `placementGroup`, then lists placement IDs in `relationships.orderedPlacements.data` in display order. Uploading and placing screenshots does not submit the parent version for review.

`upload_asset` transfers bytes to any existing reservation that returns a supported Apple upload plan. Supply its GET-by-id Apple operation, `resource_id`, `file_name`, and one file source. The tool fetches the reservation, verifies its file size, and uploads all byte ranges. Its result includes MD5 and SHA-256 checksums of the original bytes. It does not commit. Use the generated PATCH operation afterward because checksum fields differ across asset resources. Storage transfers currently support HTTPS PUT operations on `*.blobstore.apple.com` and reject redirects or credential-bearing headers.

### Read binary reports

Gzip and CSV responses return a text metadata block and an embedded resource containing base64 bytes. Metadata includes the MIME type, `totalBytes`, `sha256`, the returned byte count, and `nextOffset` when more data remains. Generated tools accept `response_limit`, up to 1 MiB, and `response_offset`. After the first chunk, pass its `sha256` as `expected_sha256`. The server refuses a changed report instead of combining different versions.

Every chunk request downloads the Apple report again. The server bounds each Apple response to 64 MiB and each MCP result to 3.5 MiB. Larger Apple reports require a deployment with a different artifact delivery path. JSON responses above the MCP result limit return `response_too_large`; reduce Apple's `limit` or requested `fields`. The MCP request limit remains 4 MiB, below the hosted proxy's 4.5 MB limit.

## Deploy

Each app is its own Vercel project in the `provorovcom` team, connected to this repo. Pushes to `main` deploy to production. Other branches get preview deployments behind Vercel Authentication.

| Project | Root directory | Production URL |
| --- | --- | --- |
| `asc-mcp-landing` | `apps/landing` | https://ascmcp.dev |
| `asc-mcp-web` | `apps/web` | https://app.ascmcp.dev |
| `asc-mcp-api` | `apps/api` | https://api.ascmcp.dev |
| `asc-mcp-mcp` | `apps/mcp` | https://mcp.ascmcp.dev |

`apps/api` and `apps/mcp` use Vercel's Hono preset. The preset loads `server.mjs`, which re-exports the tsdown bundle in `dist/main.mjs`. Vercel never compiles the workspace TypeScript itself. `src/index.ts` is the local Node server and is not used on Vercel.

Environment variables per project:

- `asc-mcp-landing`: `NEXT_PUBLIC_APP_URL` (`https://app.ascmcp.dev`).
- `asc-mcp-web`: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_MCP_URL`.
- `asc-mcp-api`: `DATABASE_URL`, `ENCRYPTION_KEYS`, `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `WEB_ORIGIN` (`https://app.ascmcp.dev`).
- `asc-mcp-mcp`: the api variables plus `MCP_RESOURCE_URL`. `MCP_ENFORCE_AUDIENCE` stays unset, so the audience check is on.
- All four: `ENABLE_EXPERIMENTAL_COREPACK=1`, so Vercel uses the pnpm version in `packageManager`.

`DATABASE_URL` is the Supabase transaction pooler URL (port 6543). `api` and `mcp` must share one `ENCRYPTION_KEYS` value, and it must differ from local dev. Losing it makes every stored key unreadable.

Apply migrations to the hosted database with `supabase link --project-ref <ref>` and then `supabase db push`. Then check that `postgres` can switch to the app role: `set role app_user; select 1;` in the SQL editor.

The MCP URL is registered in Clerk as an OAuth resource (Clerk `configure_mcp_server`) twice: `https://mcp.ascmcp.dev` and `https://mcp.ascmcp.dev/`. Clerk issues each token with the audience the client asked for.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and [SECURITY.md](SECURITY.md) for private vulnerability reports. Keep credentials and customer data out of public issues and PRs.

## License

[MIT](LICENSE), copyright 2026 Kirill Provorov.
