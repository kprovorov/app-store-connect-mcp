# Contributing

Use Node 26 and pnpm 12.16.1 (pinned in `package.json`). Install the Supabase CLI and Docker for the local database. Create your own Clerk development application; never use production credentials for a contribution.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
cp apps/landing/.env.example apps/landing/.env.local
pnpm --filter @asc-mcp/crypto gen-key
supabase start
```

Fill the examples with your local database URL, generated development encryption key, and Clerk development keys. Enable Clerk organizations and require an active organization; allow `http://localhost:3000` in the development instance. The web publishable key and backend keys must belong to the same instance. Backend processes read the root `.env`; Next.js reads each app's `.env.local`.

`supabase start` applies migrations to a new local stack. After pulling new migrations, run `pnpm --filter @asc-mcp/db db:migrate`. Then run `pnpm dev`.

For local MCP testing, temporarily set `MCP_DEV_ACCEPT_SESSION_TOKENS=true` and keep `MCP_ENFORCE_AUDIENCE=false`. For the real OAuth flow, use your own HTTPS endpoint, set `MCP_RESOURCE_URL` and `NEXT_PUBLIC_MCP_URL` to it, register that exact resource URL in your Clerk instance, and enable audience enforcement. A bare origin and its trailing-slash spelling are separate Clerk registrations; register both if supporting both client spellings. See the README's MCP section.

Before opening a PR:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm test:db
pnpm build
pnpm audit --audit-level high
gitleaks git . --log-opts='--all --full-history' --redact=100
```

DB tests use `DATABASE_URL` or the default loopback Supabase URL. They create and delete test rows: use a disposable local database, never production. CI uses PostgreSQL 17, creates the local Supabase role names, and applies every committed SQL migration. Apple requests and auth are mocked by these tests; a passing suite does not prove a live provider round trip. Builds need network access for Google Fonts and the public Next.js environment values above.

Keep changes focused, describe the resulting behavior, and list checks run in the PR. Add a regression test when changing behavior. Do not attach live `.p8` files, tokens, customer records, or raw production logs. Keep new fixtures synthetic and generated keys ephemeral.

CI runs unprivileged `pull_request` jobs with no production secrets. External GitHub Actions are pinned by commit SHA. Do not introduce a privileged workflow that executes untrusted fork code. The exact historical Gitleaks exceptions are reviewed dummy PEM headers; do not broaden them to whole files or secret types. Use [SECURITY.md](SECURITY.md) for private reports.

Contributions are distributed under this repository's [MIT license](LICENSE).
