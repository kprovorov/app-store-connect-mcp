# Fix re-check: 942737e vs d47ae95

Reviewer: claude-opus-5-5. Read-only, focused. No source edits, commits, pushes, or delegates.

## VERDICT: APPROVE

No proven blocking regressions.

## No-comments check (comment-sicko)

Scope: the source diff (`uploads.ts`, `operations.ts`, `assets.ts`, `registry.ts`, `server.ts`, `catalog-builder.ts`, tests, `ci.yml`, `tsconfig.json`). Added comments: 0. Deleted: 0. MUST KILL: 0. Suppressions: 0. Skipped `.audit` prose and generated JSON.

## Fix checks

- **B1 fixed.** `apps/mcp/src/uploads.ts:116` polls only while the state is `UPLOAD_COMPLETE`. At `:122-128`, `AWAITING_UPLOAD` sets `stage="commit"` and fails with the `appAssetLibraryImages_updateInstance` operation, the path, and an `uploaded:true` body. It doesn't place the image. The test calls resume 3 times; every call errors, every request is a GET, and none hits `/placements`.
- **Review states.** The allowlist at `:130` adds READY_FOR_REVIEW, WAITING_FOR_REVIEW, IN_REVIEW and ACCEPTED. FAILED is still an error. Tested.
- **Quota and network errors.** `uploadFailure` at `:54-67` keeps `retryAfterSeconds` and `rateLimit` for quota errors. Network errors keep their tag and a message, with no cause. Tested.
- **Content-Length.** `assets.ts:106-109` drops the header when it's digits and equals `part.length`, and throws otherwise. Tested for both match and mismatch.
- **Codepoint sort.** `catalog-builder.ts:122`. The `operations.json` diff is one line, the checksum.
- **Fallbacks.** `operations.ts:47-69` and `registry.ts:265-268`:
  - Method gate: GET goes only to read, and mutations only to write.
  - Schema validation: Ajv checks the wrapper with `additionalProperties:false`, then the generated handler runs `operationRequest`, which validates the query and body.
  - `connection_id` inside `arguments` is rejected. The outer one goes to `withConnection` in the generated handler, so isolation is unchanged.
  - Both fallbacks are listed before `operationDefinitions`, so they're on the first page.
  - Annotations: read is `readOnlyHint`; write is `destructiveHint` and `openWorldHint`.
  - The test checks routing and that 5 invalid calls make no network calls, including a foreign `connection_id` and an id of `..`.
- **Aliases.** The 5 write annotations are back, along with `additionalProperties:false` and the check that `connection_id` stays optional.
- **CI and types.** `ci.yml:41` runs `catalog-independent.py`, which is tracked. `tsconfig` includes `scripts`.
- **Witnesses.** `catalog-negative-result.json` has 19 `"pass": true`. The resolution doc doesn't claim semantic equivalence, and it notes the lint gap.

Targeted reruns at head:
- `registry.test.ts` and `assets.test.ts`: 22/22 pass.
- `uploads.db.test.ts` on `127.0.0.1:55485/asc_mcp_test`: 11/11 pass.

I didn't rerun the full suites. The root's 147/39/8/4 counts come from its trail.

## Remaining material gaps (nonblocking)

1. **Fresh path behavior changed.** The original review said to leave the fresh-path loop alone, but the polling change also covers a new upload. If Apple's commit PATCH response still says `AWAITING_UPLOAD` because of eventual consistency, a new upload now fails with a commit-stage error instead of polling. Recovery is to re-send the PATCH, which is idempotent and named in the error, so this fails safe. Apple's real response is unverified.
2. `asc_write_operation` sets `destructiveHint:true` for every mutation, including POST creates. That's conservative and fine.
3. Live App Store Connect writes, uploads, processing states, placement, other storage hosts, and Apple's reservation expiry all remain unverified, as the trail says.
4. The independent normalizer comes from the same model family, and backend lint coverage is missing. Both are documented, not hidden.

## Needs attention (trail)

- **Attention (gpt-6.1-sol).** Gap 1 changes the reviewer's explicit "leave the fresh-path loop alone". No TSV row records that deviation.
- **Attention.** The final verify row (19:33:44) cites full-suite counts I didn't independently rerun. My targeted reruns match.
- The rows for B1, the fallbacks, and the witnesses match the diff and test outputs.
