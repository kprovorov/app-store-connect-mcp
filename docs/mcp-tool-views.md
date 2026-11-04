# MCP tool views

The root connection advertises only `discover` and `execute`. Explicit URL views advertise direct tools. Both forms call the same handler, so request validation, connection selection, Apple credentials, uploads, and report chunks keep one implementation.

## Registry ownership

`ToolEntry` in `apps/mcp/src/registry.ts` owns a tool's definition, handler, groups, and optional Apple operation. Convenience tools declare groups next to their Effect schemas in `tools.ts`. Generated tools derive definitions and read-only status from the pinned operation catalog. `tool-groups.ts` classifies resource families and defines presets.

`tool-views.ts` parses the URL into one request's selected entries. `server.ts` uses those entries for both listing and execution. It never dispatches a hidden direct tool through a global handler map. Compact execution resolves convenience names, generated names, and Apple operation IDs against that same selected registry.

## Selection rules

A comma-separated selector includes any of its values. Different selectors narrow one another. Presets also narrow the selection. Read-only mode removes all entries without an explicit read annotation. Catalog GET operations are reads. Every catalog mutation, convenience write, and upload is a write.

The arbitrary-path `asc_get` helper belongs to no group. The compact root, unfiltered full view, and an explicit tool selection can expose it. Group and role preset views cannot expose it because it could read a resource outside their selection.

Each HTTP request builds its own view. No session or global mutable selection is shared between callers. The OAuth audience remains the configured root resource. URL settings are request configuration, so a caller can change them by connecting to another URL.

## Bounded discovery

Compact search returns metadata without full schemas. Exact lookup returns one schema and removes `connection_id` from the nested arguments contract. `execute` accepts that value only in its outer envelope. Direct tool schemas retain the top-level connection field.

Direct tool lists sort by canonical name. Pages stop at 100 tools or 512 KiB. Cursors contain an offset and a fingerprint of the pinned catalog and selected tool set. The server rejects a cursor for another selection, invalid offsets, and malformed encodings.

## Design choice

A policy layer over separate definition and handler registries would require each new tool to remain synchronized across multiple lists. The unified registry keeps those properties together and derives every view. Existing business handlers remain intact. Resource classification lives in a separate pure module to avoid a registry and view import cycle.

The design keeps selection local to each request, intersects filters, enforces read-only mode, and bounds pagination. Policy stays outside the handler context.

## Verification

`pnpm --filter @asc-mcp/mcp test` exercises the Hono application and MCP transport. It checks all preset views, strict selectors, hidden calls, every generated write in read-only mode, complete catalog paging, exact advertised schemas, cursor rejection, and concurrent request isolation.

`pnpm --filter @asc-mcp/mcp test:db` preserves connection isolation, every Apple HTTP method, uploads, and binary-report execution through the compact envelope. `pnpm --filter @asc-mcp/mcp check:catalog` verifies that the pinned catalog remains reproducible.
