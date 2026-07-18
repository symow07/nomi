-- =============================================================================
-- 0015 — pg-boss schema ownership (found by the production boot-and-probe
-- test): the queue library manages its own tables inside schema `pgboss`, and
-- the least-privilege runtime role may own THAT schema and nothing else.
-- Admin credentials create it once; the role never needs database-level CREATE.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'pgboss') then
    execute 'create schema pgboss authorization yiwuflow_app';
  end if;
  -- pg-boss always issues CREATE SCHEMA IF NOT EXISTS, and PostgreSQL checks
  -- the privilege BEFORE the existence — the role needs database-level CREATE
  -- (schema creation only; grants no access to other schemas' objects).
  execute format('grant create on database %I to yiwuflow_app', current_database());
end $$;

grant usage, create on schema pgboss to yiwuflow_app;
grant all on all tables    in schema pgboss to yiwuflow_app;
grant usage on all sequences in schema pgboss to yiwuflow_app;

insert into _migrations (version, name) values (15, 'pgboss_schema')
on conflict (version) do nothing;
