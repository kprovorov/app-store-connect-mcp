CREATE TYPE "public"."asc_key_kind" AS ENUM('team', 'individual');--> statement-breakpoint
CREATE TABLE "asc_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"key_kind" "asc_key_kind" NOT NULL,
	"issuer_id" uuid,
	"key_id" text NOT NULL,
	"encrypted_private_key" text NOT NULL,
	"vendor_number" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone,
	CONSTRAINT "asc_connections_org_key_unique" UNIQUE("org_id","key_id"),
	CONSTRAINT "asc_connections_team_has_issuer" CHECK (("asc_connections"."key_kind" = 'team') = ("asc_connections"."issuer_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "asc_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "asc_connections_org_id_idx" ON "asc_connections" USING btree ("org_id");--> statement-breakpoint
CREATE POLICY "members read their orgs" ON "asc_connections" AS PERMISSIVE FOR SELECT TO "app_user" USING ("asc_connections"."org_id" = any((select app.org_ids())::text[]));--> statement-breakpoint
CREATE POLICY "admins insert" ON "asc_connections" AS PERMISSIVE FOR INSERT TO "app_user" WITH CHECK ("asc_connections"."org_id" = (select app.admin_org_id()));--> statement-breakpoint
CREATE POLICY "admins update" ON "asc_connections" AS PERMISSIVE FOR UPDATE TO "app_user" USING ("asc_connections"."org_id" = (select app.admin_org_id())) WITH CHECK ("asc_connections"."org_id" = (select app.admin_org_id()));--> statement-breakpoint
CREATE POLICY "admins delete" ON "asc_connections" AS PERMISSIVE FOR DELETE TO "app_user" USING ("asc_connections"."org_id" = (select app.admin_org_id()));