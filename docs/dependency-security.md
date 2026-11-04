# Dependency security notes

Reviewed 2026-11-04. Recheck with `pnpm audit` when updating dependencies; these notes are not a permanent exemption. CI uses `pnpm audit --audit-level high`, so high and critical advisories fail while lower-severity findings remain visible.

## esbuild: GHSA-67mh-4wv8-2f99

The legacy loader under `drizzle-kit` brought in `esbuild@0.18.20`. A parent-specific pnpm override selects `0.25.12`, above the patched floor of `0.25.0`. The loader uses esbuild's transform API; validate schema generation as well as tests when changing this override. No global esbuild override is applied. Remove this override when drizzle-kit drops the old loader or updates its dependency.

## minimatch: GHSA-g3hv-75wg-m249 (moderate)

The audit flags `minimatch@10.2.6` and `3.1.5` in shadcn and ESLint's tooling dependency paths. The upstream fix is in `11.0.1`; no compatible patch release was available in the installed major lines at review time. A global major upgrade would break consumers of minimatch 3's callable CommonJS export, so it is not forced.

The reported amplification occurs with attacker-controlled glob patterns and `optimizationLevel >= 2`. This application does not expose a minimatch/glob API to HTTP or MCP callers. The affected consumers process local project files and tooling configuration. Treat outside repository changes and component registries as untrusted code: run tooling with no production credentials, keep fork CI unprivileged, and review changes before authorizing deployment.

Revisit when the parent packages adopt minimatch 11 or upstream publishes compatible fixes. Source publication does not make this dependency path safe for arbitrary untrusted generator inputs.

## deepmerge: GHSA-gcqx-w48m-w2h4 (low)

`deepmerge@4.3.1` is brought in by shadcn and its registry package. No patched release was available at review time. shadcn is a development dependency in both frontend apps: builds import its static `tailwind.css`; application TypeScript does not import its CLI or deepmerge. Moving it to devDependencies does not remove it from build machines or the audit.

Use only reviewed component registries/configuration, and run generation without production credentials. Revisit when upstream ships a fix or a shadcn update removes the affected dependency. Do not downgrade or suppress the advisory merely to make audit output green.

## Sources

- [esbuild advisory](https://github.com/advisories/GHSA-67mh-4wv8-2f99)
- [minimatch advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249)
- [deepmerge advisory](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)
