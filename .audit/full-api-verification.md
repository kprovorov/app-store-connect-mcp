# Full API verification

The goal is callable coverage of every operation in Apple's pinned App Store Connect 4.5.1 specification, including screenshot uploads through the current asset library.

## Verified locally

- `pnpm --filter @asc-mcp/mcp check:catalog` reproduces all 1,303 operation descriptors from the pinned source without a diff.
- `python3 .audit/evidence/catalog-independent.py` independently matches all methods, paths, merged parameters, body references, response media, stable names, and source hashes.
- Every generated input schema compiles. Runtime tests cover required parameters, enums, nullable values, unions, open Apple body objects, and safe path segments.
- `pnpm typecheck` passes all eight configured tasks.
- `pnpm lint` passes both configured application lint tasks. The backend packages do not define separate lint tasks.
- `pnpm test` passes 147 tests across five package tasks. The unchanged crypto package reuses its Turbo cache; the affected packages execute their tests. This run followed the source freeze and review fixes.
- `DATABASE_URL=postgresql://postgres@127.0.0.1:55485/asc_mcp_test pnpm test:db` passes all 39 tests in the database, API, and MCP packages against a disposable PostgreSQL 17 cluster with repository migrations. The MCP suite includes 19 tests.
- The upload integration suite uses an actual local HTTP server. It verifies generated GET, POST, PATCH, and DELETE requests, exact upload byte slices, no API authorization on storage requests, upload before commit, processing continuation, ownership checks, placement reuse, actionable Apple errors, transfer failures, and CSV responses.
- `pnpm build` passes all four production builds with the synthetic public configuration used by CI. The initial run executed all four builds; the run after review fixes rebuilt MCP and reused the unchanged application builds. The MCP bundle is about 3.77 MB.
- A smoke check imports the built MCP artifact with synthetic configuration. OAuth metadata returns 200, and an unauthenticated tools/list call returns 401.
- `pnpm audit --audit-level high` passes with no high or critical findings. It reports one low and one moderate advisory.
- `gitleaks dir apps/mcp/spec --redact=100 --no-banner` reports no secrets in the pinned specification.
- `gitleaks git . --log-opts='--all --full-history' --redact=100 --no-banner` reports no secrets across 83 commits at the initial implementation head.
- From `apps/mcp`, `node --import tsx ../../.audit/evidence/catalog-negative.ts` compiles every schema and passes all 19 preserved runtime witnesses. The result is kept in `.audit/evidence/catalog-negative-result.json`.

## Compact catalog follow-up

The later user revision removes public per-endpoint tools. The server advertises and registers exactly 28 tools. All 1,303 operation schemas remain available through search, describe, and read/write execution. The parent verified 52 MCP unit tests, 19 MCP database integration tests, the MCP type check and production build, deterministic catalog regeneration, independent source correspondence, and all 19 runtime witnesses. The listing regression checks the exact count and a single response below 64 KiB. The endpoint-specific public tool names are rejected. Earlier independent approvals apply to their recorded heads; this follow-up was verified by the parent.

## Live verification limits

No live App Store Connect operation or production upload was performed. API roles, Apple upload host responses, real screenshot processing, and live placement behavior remain unverified against an Apple account. Local fixtures establish the implemented request flow and isolation behavior.

Inline files are limited to 2 MiB. Public HTTPS sources are limited to 20 MiB. Transfers support Apple-issued HTTPS PUT operations on blobstore.apple.com subdomains. Each Apple response is bounded to 64 MiB, and each MCP result is bounded to 3.5 MiB. Binary chunk retrieval refetches the complete Apple response and requires a matching SHA-256 after the first chunk.

The coverage boundary is the pinned App Store Connect specification. Apple's separate App Store Server API, Transporter, and website-only actions are outside that specification.

## Review

The independent design review, catalog audit, and code review are preserved in `.audit/evidence`. The code review at `d47ae95` requested changes for uncommitted screenshot continuation. The regression is fixed and verified through actual HTTP integration tests. Review hardening also covers processed states, retry information, Content-Length, operation-ID fallbacks, deterministic ordering, script type checks, and CI source correspondence. The focused review by claude-opus-5-5 approves code head `942737e`. It reran 22 unit cases and 11 upload database cases. The full-suite counts above were verified by the parent, not independently repeated by that reviewer.
