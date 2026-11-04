# Security policy

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/kprovorov/app-store-connect-mcp/security/advisories/new) when enabled. If it is unavailable, email [kirill@provorov.dev](mailto:kirill@provorov.dev). Do not report vulnerabilities, private keys, tokens, customer data, or database exports in public issues or pull requests.

Include the affected commit, reproduction steps using synthetic data, impact, and a suggested fix if available. Remove credentials from logs and screenshots. Responses and fixes are best effort; there is no guaranteed response time.

## Supported code

Security fixes target the latest `main` commit. Older snapshots and forks must incorporate those fixes themselves.

## Credential and access model

- Users upload App Store Connect `.p8` private keys. The API verifies them with Apple and stores their contents encrypted with AES-256-GCM, bound to the organization and connection through authenticated additional data.
- API and MCP servers hold the encryption keyring and can decrypt stored keys to sign Apple requests. Server operators with database and keyring access can also decrypt them.
- Clerk authenticates users. Organization admins manage connections. Every organization member can use that organization's connections through MCP, including the write tools their Apple API key permits. OAuth membership results can be cached for 30 seconds after a membership change.
- MCP includes tools that change review replies, version localization, TestFlight notes, and testers. Use Apple keys with the minimum required role. A shared organization connection grants members the capabilities of that key.
- Production must keep `MCP_DEV_ACCEPT_SESSION_TOKENS` unset/false and `MCP_ENFORCE_AUDIENCE` unset/true. Local examples turn off the audience check because Clerk requires an HTTPS resource registration.
- Keep production credentials out of previews and require authorization before deploying outside fork PRs. Deployment viewer authentication alone does not protect secrets from build code.

If an Apple key leaks, revoke it in App Store Connect. Rotate other exposed credentials with their provider. When rotating `ENCRYPTION_KEYS`, retain old versions until all corresponding ciphertext has been migrated; losing an old key makes its stored connections unreadable.

## Dependency advisories

See [dependency security notes](docs/dependency-security.md) for the current tooling advisories and mitigations. CI rejects high and critical advisories; lower-severity findings remain visible for review.
