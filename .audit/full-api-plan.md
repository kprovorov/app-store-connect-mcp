# Full App Store Connect API support

The goal is to expose every operation in Apple's published App Store Connect OpenAPI specification through MCP, including screenshot uploads.

## Definition of done

- A pinned, reproducible Apple specification generates a callable tool for every operation with no skipped methods or unresolved input references.
- Existing named tools and connection selection continue to work.
- Generated tools validate path, query, and request bodies before contacting Apple.
- Binary responses are delivered to callers instead of rejected.
- A screenshot can travel from supplied file bytes through reservation, Apple upload operations, commit, processing status, placement, and ordering.
- Credential isolation, host restrictions, tool annotations, and retry rules apply to the expanded catalog.
- Coverage checks, fixture HTTP tests, type checks, and builds pass. Live Apple operations require separate evidence and are not inferred from fixtures.

## Workflow

1. Ground the existing request path and inspect Apple's current specification. Capture the unchanged test baseline.
2. Compare two implementation designs. Select the smallest design that meets the full operation and file transfer contracts.
3. Build the deterministic catalog generator and an independent coverage check before integrating request execution.
4. Add validated execution and binary response support. Verify representative methods, relationships, permissions, and malformed inputs through MCP.
5. Add file transfer and screenshot workflow support. Verify multipart byte ranges, commit ordering, processing errors, and credential isolation against an HTTP fixture.
6. Review the complete diff and decision trail independently. Run the relevant repository checks and create a reviewable PR.

## Throughput checkpoint

- Blocking first steps. Obtain the official specification, inspect operation and media types, and establish the existing tests before code changes.
- Independent workstreams. Grounding and design candidates have separate output locations. Catalog generation and transfer support may separate only after their contracts are fixed.
- Shared mutable state. One implementation owner controls the coupled source changes. Reviewers do not edit its files.
- Smallest safe decomposition. Generate repeated endpoint definitions deterministically. Keep file transfer as a bounded capability beside the existing authenticated Apple client.

## Open evidence

The current catalog has 22 tools. No live Apple writes are authorized by this implementation task. Production screenshot uploads and API role access must be reported as unverified unless separately exercised with explicit test-account authorization.
