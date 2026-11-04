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
