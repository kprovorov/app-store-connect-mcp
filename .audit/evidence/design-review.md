# Cross-judge verdict: ASC full API design

**Base: the Codex candidate** (generated per-operation tools). Take search and describe from the Claude candidate, as the synthesis already does. The synthesis is sound to implement once the two blocking fixes below are in.

## Spec facts checked (pinned 4.5.1)

- 1,303 operations: 826 GET, 180 POST, 162 PATCH, 135 DELETE. All operationIds are present and unique. There are 0 summaries.
- Operation-level parameters are all `query` (3,485). 819 paths declare **path-level** parameters, so the generator must merge them.
- 363 request bodies, all `application/json`.
- 177 IDs exceed 64 characters even as `asc_<id>`. The longest ID is 105 characters.
- The asset-library flow exists end to end: `/v1/apps/{id}/assetLibrary` → `appAssetLibraryImages_createInstance` (needs `assetLibrary`, `fileName`, `fileSize`, `category`) → update → `appAssetLibraryPlacements_createInstance` → `appAssetLibraryPlacementOrderingRequests_createInstance` (with `appStoreVersionLocalization`). `appAssetLibraryRefData` exists.
- `apps/mcp/src/tools.ts` and `registry.ts` exist, as the candidates assume.

## Scores (1–5, synthesis rubric)

| # | Criterion | Codex | Claude |
|---|---|---|---|
| 1 | Every operation discoverable, validated, callable | 5. Per-operation tools, path-level parameter merge, fail-closed generator | 4. Reachable only through arguments to generic executors, no per-operation schema in the catalog |
| 2 | Auth and aliases preserved | 5. One `executeRequest` owner for aliases and generated tools | 5. `withConnection`/`Bound`, aliases unchanged |
| 3 | Screenshots reach processing and placement without leaking credentials | 5. Current asset library, provenance-only upload plan, bounded poll plus continuation | 3. Defaults to deprecated screenshot sets. `replace` deletes. Asset library is left as an open question |
| 4 | Catalog and file payloads within hosted limits | 4. Paginated `tools/list`, base64 limit stated honestly, source-URL option | 2. Sets `maxRequestBodySize` to 32 MiB, above Vercel's 4.5 MB proxy limit |
| 5 | Generator and independent checks prove completeness and reproducibility | 5. Independent method/path bijection, byte-identical regeneration | 4. Good count tests, but the catalog is derived at runtime with no independent cross-check |
| 6 | One owner per invariant, small extension interface | 4. Clear module owners. Ajv is the single validator | 3. `toStrict` adds `additionalProperties:false` to every object, which contradicts Apple's open objects. Two validation layers |
| | **Total** | **28** | **21** |

The Claude candidate adds real value in one place: it measured the catalog size (787 KB params-only) and name-length pressure (809 IDs over 40 characters), and it designed `UploadPlan` branding by provenance. Keep both ideas.

## Blocking synthesis errors

**B1. The tool-name budget is wrong.** "No longer than 64 characters" counts only the bare name. Claude clients expose `mcp__<server>__<tool>` and enforce 64 characters on that full string. A 64-character generated name therefore fails on Claude Code and the Anthropic API, which breaks rubric 1 for the main client.
*Remedy:* cap generated names at 40 characters. Keep a readable prefix and add an 8-hex SHA-256 digest of the full operationId when the name is truncated. Keep the manifest mapping from original ID to name. `describe` returns the exact tool name. Add a test that asserts `len ≤ 40`, uniqueness, and stability across regeneration.

**B2. Range retrieval by refetch can mix response versions.** "Refetches the Apple response and returns a bounded byte slice, without process-local continuation state" lets a client stitch slices taken from different response bodies if Apple's output changes between calls.
*Remedy:* the first call returns `{totalBytes, sha256}` of the decoded body. Each slice call takes `expected_sha256`, refetches, recomputes the digest, and fails with a specific error on a mismatch instead of returning bytes. A test covers the mismatch.

## Must carry over from the base (missing from the synthesis text)

These are not errors in the synthesis, but the implementation fails rubric 1 or 3 without them:

- Merge path-level and operation-level parameters (819 paths).
- Image reservation needs the asset-library ID, resolved through `/v1/apps/{id}/assetLibrary` from the localization's app.
- The upload transfer accepts only `uploadOperations` parsed from an Apple response in the same call: HTTPS only, no userinfo, `redirect: "error"`, exact non-overlapping tiling of `[0,size)`, forbidden `authorization`/`cookie`/`host` headers, and never the JWT. Don't block on a host allowlist. Apple's storage host is unverified, and the spec doesn't define one.
- State the inline base64 decoded maximum as a constant below about 3 MiB (4 MiB × 3/4 minus envelope). Add a boundary test at that value plus one byte.
- Choose one validation authority before coding. The schema the catalog advertises for each tool (its JSON Schema) is what gets validated. Use the Effect import only if a test proves it accepts and rejects the same generated fixtures for all 1,303 parameter sets and 363 body schemas. Otherwise use Ajv.

## Not proposed

No change to the 4 MiB request limit. No durable staging or database changes.
