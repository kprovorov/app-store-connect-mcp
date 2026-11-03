import { Config, Schema } from "effect";

/**
 * Clerk's Frontend API origin, which is the OAuth issuer. A publishable key is
 * `pk_<env>_` plus base64 of `<frontend api host>$`.
 */
export const clerkIssuer = (publishableKey: string): string | undefined => {
  const match = /^pk_(?:test|live)_([A-Za-z0-9+/=]+)$/.exec(publishableKey);
  if (!match) return undefined;
  const host = Buffer.from(match[1] ?? "", "base64").toString("utf8");
  return /^[a-z0-9.-]+\$$/i.test(host) ? `https://${host.slice(0, -1)}` : undefined;
};

const PublishableKey = Schema.String.pipe(
  Schema.check(Schema.makeFilter((key: string) => clerkIssuer(key) !== undefined || "not a Clerk publishable key")),
);

export const McpConfig = Config.all({
  port: Config.Port("PORT").pipe(Config.withDefault(8788)),
  resourceUrl: Config.URL("MCP_RESOURCE_URL").pipe(Config.map((url) => url.href)),
  webOrigin: Config.URL("WEB_ORIGIN").pipe(Config.map((url) => url.origin)),
  clerkSecretKey: Config.Redacted("CLERK_SECRET_KEY"),
  clerkPublishableKey: Config.schema(PublishableKey, "CLERK_PUBLISHABLE_KEY"),
  acceptSessionTokens: Config.Boolean("MCP_DEV_ACCEPT_SESSION_TOKENS").pipe(Config.withDefault(false)),
  enforceAudience: Config.Boolean("MCP_ENFORCE_AUDIENCE").pipe(Config.withDefault(true)),
});
