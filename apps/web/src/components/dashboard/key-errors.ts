import type { VerifyFailureReason } from "@asc-mcp/contracts";

import { ApiRequestError } from "@/lib/api";

export type KeyField = "name" | "issuerId" | "keyId" | "privateKey" | "vendorNumber";

const keyFields: ReadonlyArray<string> = ["name", "issuerId", "keyId", "privateKey", "vendorNumber"] satisfies ReadonlyArray<KeyField>;
const isKeyField = (field: string): field is KeyField => keyFields.includes(field);

export type Problem = { title: string; description: string };

export const verifyFailureCopy: Record<VerifyFailureReason, Problem> = {
  invalid_key: {
    title: "Apple rejected this key",
    description:
      "Check the key ID, the issuer ID, and that the .p8 file belongs to this key. A revoked key also fails here.",
  },
  forbidden: {
    title: "The key is valid, but its role can't list apps",
    description: "Create a key with the App Manager role, or Admin if agents should reply to reviews.",
  },
  network: {
    title: "Couldn't reach App Store Connect",
    description: "Apple didn't answer. Try again in a minute.",
  },
};

/** Where a failed "add key" request should show up in the form. */
export type SubmitProblem = { kind: "field"; field: KeyField; message: string } | ({ kind: "alert" } & Problem);

export function describeCreateError(error: Error): SubmitProblem {
  if (!(error instanceof ApiRequestError)) {
    return { kind: "alert", title: "Couldn't add the key", description: error.message };
  }
  switch (error.code) {
    case "invalid_input":
      return error.field && isKeyField(error.field)
        ? { kind: "field", field: error.field, message: error.message }
        : { kind: "alert", title: "Check the form", description: error.message };
    case "verification_failed":
      return error.reason
        ? { kind: "alert", ...verifyFailureCopy[error.reason] }
        : { kind: "alert", title: "Apple rejected this key", description: error.message };
    case "conflict":
      return {
        kind: "alert",
        title: "This key is already connected",
        description: "This organization already has a key with this key ID.",
      };
    case "forbidden":
      return { kind: "alert", title: "Only org admins can add keys", description: "Ask an admin of this organization." };
    default:
      return { kind: "alert", title: "Couldn't add the key", description: error.message };
  }
}
