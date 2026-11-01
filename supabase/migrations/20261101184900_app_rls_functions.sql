-- Clerk ids are not UUIDs, so never use auth.uid() here.
-- app_user is a role PostgREST never assumes, so the Supabase Data API cannot reach these tables.
do $$ begin
  if not exists (select from pg_roles where rolname = 'app_user') then
    create role app_user nologin;
  end if;
end $$;
--> statement-breakpoint
grant app_user to postgres;
--> statement-breakpoint
create schema if not exists app;
--> statement-breakpoint
create or replace function app.claims() returns jsonb
  language sql stable security invoker
  as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
--> statement-breakpoint
create or replace function app.user_id() returns text
  language sql stable security invoker
  as $$ select app.claims() ->> 'sub' $$;
--> statement-breakpoint
create or replace function app.org_ids() returns text[]
  language sql stable security invoker
  as $$
    select case
      when jsonb_typeof(app.claims() -> 'org_ids') = 'array'
        then array(select jsonb_array_elements_text(app.claims() -> 'org_ids'))
      else array[app.claims() ->> 'org_id']
    end
  $$;
--> statement-breakpoint
create or replace function app.admin_org_id() returns text
  language sql stable security invoker
  as $$
    select case when app.claims() ->> 'org_role' = 'org:admin' then app.claims() ->> 'org_id' end
  $$;
--> statement-breakpoint
grant usage on schema app to app_user;
--> statement-breakpoint
grant execute on all functions in schema app to app_user;
