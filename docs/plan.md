# Plan and decision trail

## Goal

A hosted, multi-tenant MCP server for App Store Connect (ASC). A user signs up in `web`, joins or creates a Clerk organization, and adds an ASC API key. The key is stored encrypted. The user points an agent at the `mcp` server, signs in through OAuth, and the agent calls ASC tools on that organization's behalf.

## Done means

1. `pnpm build`, `pnpm typecheck`, and `pnpm test` pass from the repo root.
2. `supabase start` plus the migrations give a schema where a cross-org `select` returns zero rows (scripted RLS test).
3. The crypto round trip passes, and decryption fails when the ciphertext is moved to another connection (AAD binding).
4. The ASC JWT signer produces a token that verifies against the matching public key with the claims Apple documents.
5. `api` rejects requests without a Clerk session and lists, creates, and deletes connections with one.
6. `mcp` answers unauthenticated requests with `401` and a `WWW-Authenticate` header that points at `/.well-known/oauth-protected-resource`. That metadata names the Clerk issuer. An authenticated `tools/list` returns the registry.
7. `web` builds and renders sign-in, the connections page, and the "connect your agent" panel.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Package manager | pnpm workspaces + Turborepo | Turborepo default, already installed |
| Effect | v4 (`effect@^4`) | Current `latest`. Delegates read the installed typings, never v3 memory |
| ASC credentials | Team or individual API key: issuer ID (team only), key ID, `.p8` | ASC has no third-party OAuth. API keys are the only supported machine auth |
| Key validation | Live `GET /v1/apps?limit=1` before save | Bad keys fail at the form, not inside an agent run |
| Encryption | App-layer AES-256-GCM, versioned envelope string, AAD = `orgId:connectionId`, master key from env | DB dump alone exposes nothing. Row swapping fails to decrypt. Version prefix allows key rotation |
| Tenancy | Connections belong to a Clerk organization | Orgs are mandatory (`force_organization_selection: true`) |
| RLS | Server connects with Drizzle, and each request runs in a transaction that does `set local role authenticated` and sets `request.jwt.claims` | Without the role switch the policies would be decorative |
| Claims shape | API: `{ sub, org_id, org_role }`. MCP: `{ sub, org_ids: [...] }` | Clerk OAuth tokens carry no org. MCP resolves memberships through the Clerk API |
| MCP URL | One URL, `https://<mcp-host>/mcp` | Clerk issues OAuth tokens whose audience is the registered resource URL. A per-org path would not match |
| MCP auth | Clerk as OAuth 2.1 authorization server, `mcp` as resource server (RFC 9728 metadata) | Native flow for Claude, Cursor, and other MCP clients |
| Connection choice in tools | Optional `connection_id` argument. Defaults when the user can see exactly one connection | Agencies may hold several ASC teams |
| Tool catalog | Registry table of tool definitions (Effect Schema input, annotations, request builder) plus a read-only `asc_get` escape hatch | One shape for every tool instead of N handlers |
| web to api | Hono RPC client (`hc<AppType>`) with the Clerk session token as bearer, through react-query | Typed contract with no codegen |

## External setup done

- Clerk dev application `App Store Connect MCP` (`app_3LW5AFDcHj4TUE1UdRirX1ovob6`), created from the `b2b-saas` template. Organizations are enabled and selection is forced.
- MCP resource registration is pending. Clerk requires an `https` resource URL, so it happens at deploy time or behind a tunnel.

## Phases

1. Research (ASC surface, integration APIs) and the base scaffold, in parallel.
2. Shared packages: `crypto`, `db`, `asc`. Verified by unit tests and the RLS script.
3. `api` and `mcp` in parallel with `web`.
4. Clerk instance config, end-to-end check, PR.
