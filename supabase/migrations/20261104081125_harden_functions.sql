-- Pin search_path on the claim helpers (Supabase advisor 0011). The bodies schema-qualify app.*
-- and only use pg_catalog builtins, which stay visible with an empty search_path.
alter function app.claims() set search_path = '';
--> statement-breakpoint
alter function app.user_id() set search_path = '';
--> statement-breakpoint
alter function app.org_ids() set search_path = '';
--> statement-breakpoint
alter function app.admin_org_id() set search_path = '';
--> statement-breakpoint
-- Hosted projects get public.rls_auto_enable(), the security definer function behind the
-- ensure_rls event trigger. It is exposed as /rest/v1/rpc/rls_auto_enable (advisors 0028, 0029).
-- The event trigger does not need EXECUTE grants. Local stacks lack the function, so guard it.
do $$ begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;
