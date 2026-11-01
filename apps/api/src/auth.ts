import { OrgId, type OrgClaims, UserId } from "@asc-mcp/db";
import { createClerkClient } from "@clerk/backend";
import { Schema } from "effect";
import type { MiddlewareHandler } from "hono";

/** What the session middleware learned about the caller. All null when signed out. */
export interface Session {
  readonly userId: string | null;
  readonly orgId: string | null;
  readonly orgRole: string | null;
}

export type SessionEnv = { Variables: { session: Session } };

export type GuardResult =
  | { readonly ok: true; readonly claims: OrgClaims }
  | { readonly ok: false; readonly code: "unauthenticated" | "org_required" };

const isUserId = Schema.is(UserId);
const isOrgId = Schema.is(OrgId);

/** The role is passed through untouched: RLS alone decides what it may do. */
export const toOrgClaims = (session: Session): GuardResult => {
  if (!session.userId || !isUserId(session.userId)) return { ok: false, code: "unauthenticated" };
  if (!session.orgId || !isOrgId(session.orgId) || !session.orgRole) return { ok: false, code: "org_required" };
  return { ok: true, claims: { kind: "org", sub: session.userId, orgId: session.orgId, orgRole: session.orgRole } };
};

// Clerk clones the request it is given through a Proxy, and undici on Node 26 rejects that clone of
// @hono/node-server's lazy Request ("Illegal invocation" on `duplex`). Clerk only reads the URL and
// headers, so it gets a plain Request with exactly those. This is also why `@clerk/hono` is not used.
export const headersOnly = (request: Request) => new Request(request.url, { headers: request.headers });

export const clerkSession = ({
  secretKey,
  publishableKey,
  webOrigin,
}: {
  readonly secretKey: string;
  readonly publishableKey: string;
  readonly webOrigin: string;
}): MiddlewareHandler<SessionEnv> => {
  const clerk = createClerkClient({ secretKey, publishableKey });
  return async (c, next) => {
    const state = await clerk.authenticateRequest(headersOnly(c.req.raw), {
      acceptsToken: "session_token",
      authorizedParties: [webOrigin],
    });
    const auth = state.toAuth();
    c.set("session", { userId: auth?.userId ?? null, orgId: auth?.orgId ?? null, orgRole: auth?.orgRole ?? null });
    await next();
  };
};
