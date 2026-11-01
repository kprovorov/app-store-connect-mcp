import { describe, expect, it } from "vitest";
import { claimsJson } from "./claims";
import type { OrgId, UserId } from "./ids";

const sub = "user_1" as UserId;
const a = "org_a" as OrgId;
const b = "org_b" as OrgId;

describe("claimsJson", () => {
  it("serializes API claims as sub, org_id, org_role", () => {
    expect(JSON.parse(claimsJson({ kind: "org", sub, orgId: a, orgRole: "org:admin" }))).toEqual({
      sub,
      org_id: a,
      org_role: "org:admin",
    });
  });

  it("serializes MCP claims as sub and org_ids", () => {
    expect(JSON.parse(claimsJson({ kind: "member", sub, orgIds: [a, b] }))).toEqual({ sub, org_ids: [a, b] });
  });
});
