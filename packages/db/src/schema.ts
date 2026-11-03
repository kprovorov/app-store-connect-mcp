import type { EncryptedSecret } from "@asc-mcp/crypto";
import { sql } from "drizzle-orm";
import { check, index, pgEnum, pgPolicy, pgRole, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import type { ConnectionId, OrgId, UserId } from "./ids";

export const appUser = pgRole("app_user").existing();

export const keyKind = pgEnum("asc_key_kind", ["team", "individual"]);

// Wrapping app.* helpers in a subselect lets Postgres evaluate them once per statement instead of once per row.
const orgIds = sql`(select app.org_ids())`;
const adminOrgId = sql`(select app.admin_org_id())`;

export const ascConnections = pgTable(
  "asc_connections",
  {
    id: uuid("id").primaryKey().$type<ConnectionId>(),
    orgId: text("org_id").notNull().$type<OrgId>(),
    name: text("name").notNull(),
    keyKind: keyKind("key_kind").notNull(),
    issuerId: uuid("issuer_id"),
    keyId: text("key_id").notNull(),
    encryptedPrivateKey: text("encrypted_private_key").notNull().$type<EncryptedSecret>(),
    vendorNumber: text("vendor_number"),
    createdBy: text("created_by").notNull().$type<UserId>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
  },
  (t) => [
    check("asc_connections_team_has_issuer", sql`(${t.keyKind} = 'team') = (${t.issuerId} is not null)`),
    unique("asc_connections_org_key_unique").on(t.orgId, t.keyId),
    index("asc_connections_org_id_idx").on(t.orgId),
    pgPolicy("members read their orgs", { for: "select", to: appUser, using: sql`${t.orgId} = any(${orgIds}::text[])` }),
    pgPolicy("admins insert", { for: "insert", to: appUser, withCheck: sql`${t.orgId} = ${adminOrgId}` }),
    pgPolicy("admins update", {
      for: "update",
      to: appUser,
      using: sql`${t.orgId} = ${adminOrgId}`,
      withCheck: sql`${t.orgId} = ${adminOrgId}`,
    }),
    pgPolicy("admins delete", { for: "delete", to: appUser, using: sql`${t.orgId} = ${adminOrgId}` }),
  ],
).enableRLS();
