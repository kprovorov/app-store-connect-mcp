# Review resolution

The initial code review targeted `d47ae95` and requested changes. Its full report is in `.audit/evidence/implementation-review.md`.

- B1 is fixed. `AWAITING_UPLOAD` returns a commit-stage error with the operation ID and commit body. Only `UPLOAD_COMPLETE` polls. Three repeated resumes return recovery instructions without placing an image.
- Processed images in review states can reuse or create placements. Terminal failed, rejected, or archived states remain errors.
- Quota errors retain retry-after and rate-limit data. Network errors retain their category and an actionable message without exposing their cause.
- Matching Apple Content-Length headers are checked and omitted so fetch sets the correct value. Mismatched lengths fail before transfer.
- Read and write operation-ID fallbacks appear on the first catalog page and route through the existing generated handlers. Tests cover method separation, input validation, and connection isolation.
- Catalog order uses codepoint comparison. The resulting catalog checksum changed; operation names and schemas did not.
- CI runs the independent source comparison. The specification README now separates source correspondence from selected runtime witnesses.
- The existing alias write-annotation and optional connection checks are restored.
- The generator script is included in the MCP type check.

## Evidence limits

The source correspondence audit used the same model family as implementation and mirrors the generator's normalization. It proves correspondence, not semantic equivalence for every JSON value. The cross-model reviewer separately checked reachable union tags and selected normalization cases. All 19 runtime witnesses and their output are now preserved in the repository.

The configured lint tasks cover the unchanged web and landing apps. Backend validation relies on type checks, runtime tests, source correspondence, and review. No backend lint coverage is claimed.

The storage host allowlist is a deliberate deviation from the design review's suggestion to rely on provenance alone. It adds a restriction based on Apple's documented blobstore example. Other upload hosts require review. Live App Store Connect uploads and account permissions remain unverified.

The commit recovery rule also applies to a fresh upload whose commit response still says `AWAITING_UPLOAD`. This deliberately replaces the initial review's suggestion to preserve fresh-path polling. It fails with an actionable error instead of assuming the commit succeeded. If Apple returns a stale state, the caller can repeat the named commit. The live response behavior remains unverified.

## Final verdict

The focused review in `.audit/evidence/fix-review.md` approves code head `942737e` with no blocking regressions. The parent reran the full suites after all source edits stopped. The reviewer independently reran the affected registry, transfer, and upload regressions. The first documentation commit after that review only preserved its evidence.

The later user revision supersedes the public per-endpoint tool design. The compact catalog follow-up changes discovery and dispatch, retains the validated execution and upload paths, and was checked by the parent. The earlier approval remains evidence for its recorded code head and is not presented as a review of the later follow-up.
