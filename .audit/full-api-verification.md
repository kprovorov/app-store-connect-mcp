# Full API verification

The goal is callable coverage of every operation in Apple's pinned App Store Connect 4.5.1 specification, including screenshot uploads through the current asset library.

## Verified locally

- `pnpm --filter @asc-mcp/mcp check:catalog` reproduces all 1,303 operation descriptors from the pinned source without a diff.
- `python3 .audit/evidence/catalog-independent.py` independently matches all methods, paths, merged parameters, body references, response media, stable names, and source hashes.
- Every generated input schema compiles. Runtime tests cover required parameters, enums, nullable values, unions, open Apple body objects, and safe path segments.
- `pnpm typecheck` passes all eight configured tasks.
- `pnpm lint` passes both configured application lint tasks. The backend packages do not define separate lint tasks.
- `pnpm test` passes 146 tests across five package tasks. The unchanged crypto package reuses its Turbo cache; the affected packages execute their tests.
- `DATABASE_URL=postgresql://postgres@127.0.0.1:55485/asc_mcp_test pnpm test:db` passes all 35 tests in the database, API, and MCP packages against a disposable PostgreSQL 17 cluster with repository migrations.
- The upload integration suite uses an actual local HTTP server. It verifies generated GET, POST, PATCH, and DELETE requests, exact upload byte slices, no API authorization on storage requests, upload before commit, processing continuation, ownership checks, placement reuse, actionable Apple errors, transfer failures, and CSV responses.
- `pnpm build` passes all four production builds with the synthetic public configuration used by CI. The MCP bundle is about 3.77 MB.
- A smoke check imports the built MCP artifact with synthetic configuration. OAuth metadata returns 200, and an unauthenticated tools/list call returns 401.
- `pnpm audit --audit-level high` passes with no high or critical findings. It reports one low and one moderate advisory.
- `gitleaks dir apps/mcp/spec --redact=100 --no-banner` reports no secrets in the pinned specification.

## Limits and live gaps

No live App Store Connect operation or production upload was performed. API roles, Apple upload host responses, real screenshot processing, and live placement behavior remain unverified against an Apple account. Local fixtures establish the implemented request flow and isolation behavior.

Inline files are limited to 2 MiB. Public HTTPS sources are limited to 20 MiB. Transfers support Apple-issued HTTPS PUT operations on blobstore.apple.com subdomains. Each Apple response is bounded to 64 MiB, and each MCP result is bounded to 3.5 MiB. Binary chunk retrieval refetches the complete Apple response and requires a matching SHA-256 after the first chunk.

The coverage boundary is the pinned App Store Connect specification. Apple's separate App Store Server API, Transporter, and website-only actions are outside that specification.

## Review

The independent design review and catalog audit are preserved in `.audit/evidence`. Final code and decision-trail review is pending.
