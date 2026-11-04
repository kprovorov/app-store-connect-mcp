# Independent catalog audit

The goal is callable coverage of every operation in Apple's pinned App Store Connect 4.5.1 specification. This audit covers the catalog and request validation while implementation is in progress. It is not a review of a committed head or the complete screenshot workflow.

## Verdict

PASS for the final artifacts recorded below. Two defects found in the earlier draft were corrected by the implementation owner before the final rerun. No source files were edited by this audit.

## Artifact identity

- Pinned specification SHA-256 is `7518d3a94a8bd701ac25c1c601b95b8f53aad92091affb15a2a9d331713dac1a`.
- Generated catalog SHA-256 is `f1f485616f3338e5c51d364501a4f19e33a0a8ac2d741416f1e16bee7e0b99cb`.
- `apps/mcp/src/catalog-builder.ts` SHA-256 is `be453455d77d2ab15c89ea08dc42acdc64853911e95b189bbf3cffcf56be05ae`.
- `apps/mcp/src/operations.ts` SHA-256 is `225da5b9ec4b37b841ce7c14d6a8e31bc8d04d0f261250ac6434e5764df7b1d7`.

## Checks run

`python3 /tmp/asc-catalog-independent.py` independently enumerates the raw specification and compares it to generated descriptors without importing the generator. It checks each method, path, operation ID, name, deprecation flag, merged parameter location, required parameter, parameter schema, body reference, reachable body definition, and successful response media type. It also checks the pinned checksum and naming stability.

Results are recorded in `/tmp/asc-catalog-independent-result.json`.

- Every one of the 1,303 source operations occurs exactly once in the generated catalog.
- Methods match 826 GET, 180 POST, 162 PATCH, and 135 DELETE.
- All 1,099 path parameter occurrences and 3,485 query parameter occurrences match. All 28 required query parameter occurrences remain required.
- Every one of the 363 request bodies and its reachable definitions matches the normalized source schema. Path constraints deliberately add nonempty and nondot segments. Empty enums deliberately map to an unsatisfiable schema.
- All generated names are unique, stable, legal, and at most 40 characters.
- Every generated reference resolves locally. All successful response media types remain present.

`node --import tsx /tmp/asc-catalog-negative.ts` was run from `apps/mcp`. It compiles each generated schema using the runtime's actual Ajv validator, then executes boundary cases and pagination against the actual implementation.

Results are recorded in `/tmp/asc-catalog-negative-result.json`.

- All 1,303 schemas compile. There are zero compilation errors.
- All 19 behavioral checks pass.
- Cases reject missing or incorrectly typed path IDs, required query omissions, string values for array queries, unknown query keys, an excessive limit, invalid enums, an incorrect JSON resource type, and missing required body attributes.
- Nullable attributes and unknown fields in Apple's open body objects remain accepted. Request construction preserves the JSON body unchanged.
- The asset-placement `anyOf` rejects an image with no localization and accepts an image with an App Store version localization.
- A subscription `included` resource satisfies the expected `oneOf` branch. An unknown included resource type fails.
- Dot-only and empty path IDs fail validation.
- Following the generated catalog pagination returns all 1,303 names exactly once across 27 pages. The largest serialized page is 119,056 bytes. This count excludes convenience and workflow tools added elsewhere.

## Defects found and corrected during this audit

1. The earlier catalog, SHA-256 `489125df6c072b577996d812a0e0893ed41f2cd41445e882f67f4cfcebc6cfaa`, failed compilation for five operations. Apple declares `fields[appKeywords].items.enum` as an empty list. Ajv rejects an empty enum as an invalid schema even when the optional query is omitted. `catalog-builder.ts:37` now converts it to `{not:{}}`, preserving that no array item can satisfy it. The final compilation rerun confirms all five work.
2. `operations.ts:27` originally inserted `encodeURIComponent(id)` without rejecting dot-only IDs. `apps_getInstance` with `{path:{id:".."}}` produced `/v1/apps/..`, which `resolveUrl` normalized to `/v1/`. Empty IDs also passed. `catalog-builder.ts:96` now advertises and validates a nonempty nondot path segment. Both negative cases fail in the final rerun.

## Limits

These checks prove source correspondence and selected runtime validation behavior for the identified artifacts. They do not establish full semantic equivalence for every JSON value, complete MCP registration, credential isolation, screenshot upload behavior, binary delivery, or live Apple responses. Those checks belong to the parent verification and final review.

Prove It Works shaped this audit. It compiled the actual generated schemas and executed actual request construction instead of accepting operation counts or type checks as proof.

## Durable rerun

The parent preserved the independent source comparison as `.audit/evidence/catalog-independent.py` and made its paths relative to this repository. `python3 .audit/evidence/catalog-independent.py` passed against the same generated catalog checksum. Runtime validation witnesses also live in `apps/mcp/src/operations.test.ts`.
