# Apple API specification

`app-store-connect-4.5.1.json` contains the unmodified JSON from Apple's [official OpenAPI download](https://developer.apple.com/sample-code/app-store-connect/app-store-connect-openapi-specification.zip). `provenance.json` pins the JSON bytes by SHA-256. The checksum applies to the extracted JSON, not the ZIP.

The catalog covers all 1,303 operations, including 159 deprecated operations. It does not cover Apple's separate App Store Server API, Transporter, or website-only actions.

Run `pnpm --filter @asc-mcp/mcp generate:catalog` after an intentional specification update. Commit the original specification, provenance, and generated catalog together. Run `pnpm --filter @asc-mcp/mcp check:catalog` to check byte-for-byte regeneration. The operation tests independently compare every method, path, parameter requirement, body, and response media type with the original specification and compile every advertised input schema.

Apple publishes an empty enumeration for several app-keyword query fields. The generator represents these as an impossible schema instead of dropping the constraint. Empty arrays remain valid where Apple specifies no minimum item count.
