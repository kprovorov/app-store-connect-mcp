import { Schema } from "effect";

export const OrgId = Schema.String.pipe(Schema.check(Schema.isPattern(/^org_[A-Za-z0-9]+$/)), Schema.brand("OrgId"));
export type OrgId = typeof OrgId.Type;

export const UserId = Schema.String.pipe(Schema.check(Schema.isPattern(/^user_[A-Za-z0-9]+$/)), Schema.brand("UserId"));
export type UserId = typeof UserId.Type;

export const ConnectionId = Schema.String.pipe(Schema.check(Schema.isUUID()), Schema.brand("ConnectionId"));
export type ConnectionId = typeof ConnectionId.Type;

export const newConnectionId = (): ConnectionId => globalThis.crypto.randomUUID() as ConnectionId;
