-- Clerk ids are not UUIDs, so never use auth.uid() here.
create schema if not exists app;
--> statement-breakpoint
create or replace function app.user_id() returns text
  language sql stable security invoker
  as $$ select auth.jwt() ->> 'sub' $$;
--> statement-breakpoint
create or replace function app.org_ids() returns text[]
  language sql stable security invoker
  as $$
    select case
      when jsonb_typeof(auth.jwt() -> 'org_ids') = 'array'
        then array(select jsonb_array_elements_text(auth.jwt() -> 'org_ids'))
      else array[auth.jwt() ->> 'org_id']
    end
  $$;
--> statement-breakpoint
create or replace function app.admin_org_id() returns text
  language sql stable security invoker
  as $$
    select case when auth.jwt() ->> 'org_role' = 'org:admin' then auth.jwt() ->> 'org_id' end
  $$;
--> statement-breakpoint
grant usage on schema app to authenticated;
--> statement-breakpoint
grant execute on all functions in schema app to authenticated;
