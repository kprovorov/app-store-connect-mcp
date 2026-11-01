import type { OrgId, UserId } from "./ids";

export type RlsClaims =
  | { readonly kind: "org"; readonly sub: UserId; readonly orgId: OrgId; readonly orgRole: string }
  | { readonly kind: "member"; readonly sub: UserId; readonly orgIds: ReadonlyArray<OrgId> };

export type OrgClaims = Extract<RlsClaims, { kind: "org" }>;

export const claimsJson = (claims: RlsClaims): string =>
  JSON.stringify(
    claims.kind === "org"
      ? { sub: claims.sub, org_id: claims.orgId, org_role: claims.orgRole }
      : { sub: claims.sub, org_ids: claims.orgIds },
  );
