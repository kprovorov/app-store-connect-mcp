# Full API design decision

The goal is to make all 1,303 operations in Apple's pinned App Store Connect 4.5.1 specification callable through MCP and support screenshot uploads.

## Compact catalog revision

The user rejected advertising every API endpoint as an MCP tool. The server now advertises 28 tools, the original 22 and six discovery, execution, and upload helpers. The 1,303 generated operation descriptors remain internal. Search returns operation IDs, describe returns the argument schema, and the read or write executor validates and executes it. Per-endpoint public handlers and tool pagination are removed. Existing connection checks, argument validation, uploads, and report handling are preserved.

## Original synthesis, superseded for tool discovery

Use the generated per-operation registry candidate as the base. Preserve the 22 existing tools. Each Apple operation gets one deterministic tool name no longer than 40 characters, with an original-operation mapping. Shortened names retain a readable prefix and an eight-character SHA-256 suffix. Paginate tools/list so each response stays below the hosted response limit. Derive runtime validation and advertised input schemas from the same normalized specification.

Graft the compact candidate's discovery tools. Search and describe let agents find an operation without retaining every schema in their prompt. Prefer the existing Effect OpenAPI import if it passes correspondence tests without broad schema rewrites. Otherwise use a maintained JSON Schema validator. Do not close all body objects merely to reject typos when Apple's specification leaves them open.

Both candidates preserve the existing authenticated Apple client. A separate file-transfer capability handles Apple-issued upload operations without access to API credentials.

Screenshot support targets the current asset-library model. Reserve an image, transfer its bytes, commit, report its processing state, create a placement in a selected localization and device group, and expose ordering through generated operations. Do not silently replace or delete existing screenshots. Bound waiting and return resource IDs for continuation.

Keep the 4 MiB MCP request limit. Inline base64 accepts a documented safe decoded size. Larger screenshots can use a public HTTPS source with DNS-pinned requests, private-address rejection, no redirects, bounded reads, and no forwarded credentials. Do not raise a transport limit beyond Vercel's 4.5 MB proxy limit. No durable upload staging or database changes are needed.

Binary results return bounded embedded resources. For larger reports support range/chunk retrieval through a tool that refetches the Apple response and returns a bounded byte slice, without process-local continuation state. The first response includes total bytes and SHA-256. Later chunks require the expected SHA-256 and fail if the response changed. Report the extra download cost.

## Rubric

1. Every method and path in the pinned spec is discoverable, validated, and callable.
2. Existing connection authorization and aliases retain their behavior.
3. Screenshot transfer reaches processing and placement without leaking API credentials.
4. Catalog and file payloads respect the hosted limits.
5. The generator and independent checks prove completeness and reproducibility.
6. The design has one owner per invariant and a small extension interface.

## Rejected choices

- A generic request executor alone does not provide per-operation tool schemas.
- The deprecated screenshot-set workflow is not the default for new upload support.
- Raising the body limit to 32 MiB does not bypass the deployment proxy.
- Handwritten endpoint lists cannot establish full coverage as Apple changes the API.

## Verification gates

The unchanged baseline passed 75 tests and both affected package type checks. Next gates are source-to-catalog correspondence, every schema compiling, paginated catalog traversal, fixture HTTP requests for all methods and file media, adversarial upload-source checks, real local PostgreSQL isolation checks, repository checks, and independent diff review. Live Apple writes remain unverified.
