# Final review: full App Store Connect API + screenshot uploads

Goal: make all 1,303 operations in Apple's pinned App Store Connect 4.5.1 spec callable through MCP, including screenshot uploads. Head `d47ae9585e13d962da80c3f44e07406c0e1dca03` vs base `a53a845`. Reviewer: claude-opus-5-5. No source edits.

## VERDICT: CHANGES REQUESTED

One small blocking defect in the resume path, which is part of the requested scope. Everything else holds up.

## Blocking

**B1. Resuming an uncommitted image reports `processing` and never progresses.** `apps/mcp/src/uploads.ts:98-107`
- Trigger. `AscClient` retries 5xx only for GET (`packages/asc/src/client.ts:212-213`). So a commit PATCH that hits a 5xx or a timeout fails on the first try, with `AssetError{stage:"commit", image_id}`. `README.md:125` says errors keep the image ID "so an agent can inspect or repair". That reads as an invitation to resume.
- Counterexample (measured). I called `uploadScreenshot` three times in a row with `image_id`, and the image GET returned `state: "AWAITING_UPLOAD"`. Every call returned `{state:"processing", apple_state:"AWAITING_UPLOAD", next:"Call upload_screenshot with image_id..."}`. Zero PATCH requests went out.
- Inferred. Only the fresh path sends `uploaded: true`, so this loops until Apple expires the reservation (expiry unverified).
- Fix. In the `resuming` branch, treat `AWAITING_UPLOAD` as an error: `AssetError{stage:"commit", image_id}`, with a message pointing to `appAssetLibraryImages_updateInstance` `{uploaded:true}`, `upload_asset`, or a new reservation. When resuming, loop only on `UPLOAD_COMPLETE`. Leave the fresh-path loop alone.
- Test. Add a case to `uploads.db.test.ts`. The fixture image GET returns `AWAITING_UPLOAD`, and the resume call must return `isError` with `stage:"commit"` and no POST to `/v1/appAssetLibraryPlacements`.

## Nonblocking

1. `uploads.ts:108`. The success allowlist is only `PREPARE_FOR_SUBMISSION|COMPLETE|APPROVED`. Apple's `AppAssetLibraryAssetState` also has `READY_FOR_REVIEW`, `WAITING_FOR_REVIEW`, `IN_REVIEW`, and `ACCEPTED`. I reproduced resumes with `READY_FOR_REVIEW` and `ACCEPTED`, and both returned `AssetError`. Fix: fail only on `FAILED|REJECTED|ARCHIVED` and send other post-upload states on to the placement lookup.
2. `uploads.ts:120`. `AscRateLimited` and `AscNetworkError` collapse to "Screenshot upload failed" with `{error: tag}`, so `retryAfterSeconds` and the rate limit are lost. The generated-operation path keeps them.
3. `assets.ts:105`. A `content-length` entry in Apple's `requestHeaders` aborts the transfer. Apple's documented example (seen in the transcript) has only `Content-Type`, so this fails closed. Dropping the header would be safer than throwing.
4. There's no way to call an operation by ID. A client that reads only the first `tools/list` page, or caps its tool count, can find the 1,279 generated tools past page 1 but can't call them. A thin `asc_call_operation` that reuses `operationRequest` would fix it. I didn't verify any client's pagination.
5. `catalog-builder.ts:122`. The `localeCompare(..., "en")` sort depends on ICU collation, while `check:catalog` is a byte-identity CI gate. A codepoint sort removes the risk that a different Node or ICU build breaks the gate.
6. `apps/mcp/spec/README.md:7` says the operation tests compare "parameter requirement, body" with the spec. `operations.test.ts` checks only body presence and required path parameters. Required query parameters and body schemas are checked only by `.audit/evidence/catalog-independent.py`, which CI doesn't run. Either wire it into CI or fix the claim.
7. `registry.test.ts` dropped the alias write-annotation and exact schema checks. That loses coverage but isn't a bug, since alias code is unchanged.
8. `scripts/generate-catalog.ts` is outside `apps/mcp/tsconfig.json` `include`, so nothing type-checks it.

## Checked, not defects

- My reruns at head match the claimed artifacts. `check:catalog` is byte-identical and the independent checker passes (1,303 ops: 826 GET, 180 POST, 162 PATCH, 135 DELETE; 1,099 path parameters, 3,485 query parameters, 363 bodies, 28 required query parameters, max name length 40). The four SHA-256 hashes equal `catalog-audit.md`. MCP has 51 unit tests, ASC 39 unit tests, MCP DB 15 tests on `127.0.0.1:55485/asc_mcp_test`. Both typechecks are clean.
- The hand-built screenshot requests match the pinned spec: paths, `filter[id]`, `filter[placementType|placementGroup]`, `include=image|appStoreVersion|app`, `limit` at or under 200, `category: APP_SCREENSHOTS_AND_PREVIEWS`, `uploaded`, and `placementType/placementGroup`.
- Unions. All 5 `oneOf` nodes reachable from request bodies have exclusive `type` tags. Nullable `$ref` normalizes to `anyOf` with null. Each of the 3 attributes literally named `properties` (in 3 GameCenter request schemas) is normalized onto the right key.
- Validation uses the advertised schema object. Path-level parameters merge. 159 deprecated operations are included. Accept picks JSON, else the only media type (CSV verified end to end). GETs use scoped tokens. The connection path is unchanged.
- Transfers allow only HTTPS PUT to `*.blobstore.apple.com`, with no JWT, `redirect:"error"`, exact range tiling, and filtered headers. The fixture confirms storage requests carry no `authorization`.
- Source download rejects IP literals (`2130706433` and `0x7f.1` normalize to `127.0.0.1`) and any non-public DNS answer, and pins the first answer. Node 26 calls `lookup` with `{family, hints}` when `family` is set. The code handles both shapes. TLS verification stays on, there are no redirects, and the 20 MiB cap and 30 s deadline hold.
- Binary chunks bind to `sha256`, and offset > 0 requires `expected_sha256`.

## No-comments audit (comment-sicko)

Scope was every changed code file. 0 comments added, 0 deleted, 0 `MUST KILL`, 0 suppressions. Pre-existing comments in changed files: 2 public doc comments kept (`client.ts:14`, `:75`), plus 4 `REVIEW` keeps for vendor or dependency claims I can't verify:
- `client.ts:19-22` "Apple rejects the token for any other request". The claimed rule is that Apple enforces token scope.
- `client.ts:103` "Apple ignores these when matching a request against the token scope." The claimed rule is that `limit/cursor/sort` are excluded from scope matching.
- `client.ts:106` "the scope entry format Apple documents (brackets unencoded)". The claimed rule is Apple's scope format.
- `testing.ts:30` "postgres.js connects on the first query". The claimed rule is that postgres.js connects lazily.

Skipped: the spec JSON, the generated JSON, and `.audit` prose.

## Decision-trail audit

Models. The root is `gpt-6.1-sol`. The design judge and final-review delegates are `claude-opus-5-5` at xhigh effort. Spawned Codex subagents (`ground_mcp`, `ground_spec`, `design_generated`, `implement_full_api`, `catalog_audit`) record no model, so they inherit the root's.

- The rows match the transcript. Baseline 75 = 39+36. DB was 8, and the `exit_code:1` at 18:46:24 was a Python script, not the DB run. Unit 146 = 12+39+11+51+33. DB 35 = 13+7+15. Typecheck 8/8 (2 cached), lint 2/2, build 4/4, audit 1 low and 1 moderate, smoke 200 and 401, gitleaks clean.
- **Attention (gpt-6.1-sol).** Unit tests, typecheck, and lint started at 19:00:17. The implementer only confirmed "stopped editing" at 19:01:12, and they weren't rerun after that. My reruns of the affected packages at head match the counts, which mitigates this.
- **Attention (gpt-6.1-sol).** The design review said "Don't block on a host allowlist", but the code pins `*.blobstore.apple.com`. No TSV row records that deviation. It is evidenced by Apple's examples and fails closed.
- **Attention (gpt-6.1-sol).** Ajv was adopted without the recorded Effect-import attempt that the design preferred. The review allowed Ajv as a fallback, so the row is missing but the call itself is fine.
- **Attention (gpt-6.1-sol `catalog_audit`).** This "independent" check ran on the same model family as the implementer. `conv()` mirrors `normalizeSchema` line for line, so it proves correspondence, not normalization semantics. The 19 negative checks and their results JSON exist only in `/tmp`, and the row at 18:52:08 cites a temp path.
- **Attention.** The lint gate covers only `web` and `landing`, so it says nothing about the changed packages. The Node 26 DNS callback bug the root caught at 18:50 has no row.
- Live ASC writes, Apple upload hosts, processing, and placement remain unverified, as the trail states. The public-HTTPS favicon fetch was checked by the implementer only, and the root doesn't claim it.
