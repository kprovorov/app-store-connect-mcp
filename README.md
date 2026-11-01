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
