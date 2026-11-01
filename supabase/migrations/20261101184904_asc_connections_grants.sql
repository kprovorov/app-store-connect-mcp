-- drizzle-kit emits no grants, and Supabase is moving away from auto-granting new public tables.
grant select, insert, update, delete on table public.asc_connections to authenticated;
--> statement-breakpoint
revoke all on table public.asc_connections from anon;
