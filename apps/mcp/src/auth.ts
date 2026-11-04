import { OrgId, type RlsClaims, UserId } from "@asc-mcp/db";
import { createClerkClient } from "@clerk/backend";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { Schema } from "effect";

export type MemberClaims = Extract<RlsClaims, { kind: "member" }>;

export interface Org {
  readonly id: OrgId;
  readonly name: string;
}

export interface Caller {
  readonly claims: MemberClaims;
  readonly orgs: ReadonlyArray<Org>;
}

export type AuthOutcome =
  | { readonly kind: "authenticated"; readonly authInfo: AuthInfo & { readonly extra: { readonly caller: Caller } } }
  | { readonly kind: "missing" }
  | { readonly kind: "invalid" };

export type Authenticate = (request: Request) => Promise<AuthOutcome>;

export const callerOf = (authInfo: AuthInfo | undefined): Caller | undefined =>
  authInfo?.extra?.caller as Caller | undefined;

export const bearerToken = (request: Request) =>
  /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];

/** RFC 9728 path for a resource: the well-known prefix, then the resource's own path. */
export const metadataUrl = (resourceUrl: string) => {
  const resource = new URL(resourceUrl);
  return new URL(`/.well-known/oauth-protected-resource${resource.pathname.replace(/\/$/, "")}`, resource.origin).href;
};

/**
 * Token audiences accepted for a resource. Clients that build the RFC 8707 `resource` parameter
 * through `URL.href` (Claude Code does) send a bare origin with a trailing slash, and Clerk treats
 * that as a separate resource with its own audience. Both spellings are registered in Clerk.
 */
export const resourceAudiences = (resourceUrl: string): ReadonlyArray<string> => [
  ...new Set([resourceUrl, new URL(resourceUrl).href]),
];

const OAUTH_SCOPES = ["profile", "email"];

export const protectedResourceMetadata = (resourceUrl: string, issuer: string) => ({
  resource: resourceUrl,
  authorization_servers: [issuer],
  bearer_methods_supported: ["header"],
  scopes_supported: OAUTH_SCOPES,
});

export const unauthorized = (resourceUrl: string, outcome: "missing" | "invalid") => {
  const challenge = `resource_metadata="${metadataUrl(resourceUrl)}", scope="${OAUTH_SCOPES.join(" ")}"`;
  return Response.json(
    outcome === "invalid"
      ? { error: "invalid_token", error_description: "The access token is invalid or expired" }
      : { error: "unauthorized", error_description: "Sign in with OAuth to use this server" },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": outcome === "invalid" ? `Bearer error="invalid_token", ${challenge}` : `Bearer ${challenge}`,
      },
    },
  );
};

const MEMBERSHIP_TTL_MILLIS = 30_000;
const MEMBERSHIP_PAGE_SIZE = 100;
const isUserId = Schema.is(UserId);
const isOrgId = Schema.is(OrgId);

// Clerk clones the request it is given through a Proxy, and undici on Node 26 rejects that clone of
// @hono/node-server's lazy Request ("Illegal invocation" on `duplex`). Clerk only reads the URL and
// headers, so it gets a plain Request with exactly those.
const headersOnly = (request: Request) => new Request(request.url, { headers: request.headers });

export const clerkAuthenticate = (options: {
  readonly secretKey: string;
  readonly publishableKey: string;
  readonly acceptSessionTokens: boolean;
  /** Set to the MCP resource's audiences to reject tokens Clerk issued for other resources. */
  readonly audience: ReadonlyArray<string> | undefined;
}): Authenticate => {
  const clerk = createClerkClient({ secretKey: options.secretKey, publishableKey: options.publishableKey });
  const acceptsToken: Array<"oauth_token" | "session_token"> = options.acceptSessionTokens
    ? ["oauth_token", "session_token"]
    : ["oauth_token"];

  // OAuth access tokens carry no org claim, so memberships come from the Backend API.
  const memberships = new Map<string, { readonly orgs: ReadonlyArray<Org>; readonly expiresAt: number }>();
  const orgsOf = async (userId: string) => {
    const cached = memberships.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached.orgs;
    const orgs: Array<Org> = [];
    for (let offset = 0; ; offset += MEMBERSHIP_PAGE_SIZE) {
      const page = await clerk.users.getOrganizationMembershipList({ userId, limit: MEMBERSHIP_PAGE_SIZE, offset });
      for (const { organization } of page.data) {
        if (isOrgId(organization.id)) orgs.push({ id: organization.id, name: organization.name });
      }
      if (page.data.length < MEMBERSHIP_PAGE_SIZE) break;
    }
    memberships.set(userId, { orgs, expiresAt: Date.now() + MEMBERSHIP_TTL_MILLIS });
    return orgs;
  };

  return async (request) => {
    const token = bearerToken(request);
    if (!token) return { kind: "missing" };
    const state = await clerk.authenticateRequest(headersOnly(request), {
      acceptsToken,
      ...(options.audience ? { audience: [...options.audience] } : {}),
    });
    if (!state.isAuthenticated) {
      // The reason says why Clerk refused the token (audience mismatch, expired, revoked). Never log the token.
      console.warn("mcp: rejected bearer token", { reason: state.reason, message: state.message });
      return { kind: "invalid" };
    }
    const auth = state.toAuth();
    if (!auth.userId || !isUserId(auth.userId)) return { kind: "invalid" };
    const orgs = await orgsOf(auth.userId);
    return {
      kind: "authenticated",
      authInfo: {
        token,
        clientId: auth.tokenType === "oauth_token" ? auth.clientId : "clerk-session",
        scopes: auth.tokenType === "oauth_token" ? auth.scopes : [],
        extra: { caller: { claims: { kind: "member", sub: auth.userId, orgIds: orgs.map((org) => org.id) }, orgs } },
      },
    };
  };
};
