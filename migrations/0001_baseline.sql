-- =============================================================================
-- 0001 — Baseline
--
-- Records the schema as it exists BEFORE the service migration:
--   supabase/schema.sql        (tables, views, functions)
--   supabase/seed_products.sql (seed data — dev/demo databases only)
--   supabase/rls_policies.sql  (RLS enabled, anon denied)
--
-- On a database that already ran those files, this migration is a no-op marker.
-- On a fresh database, apply those three files first, then run the migration
-- chain from 0002.
--
-- From this point forward, NOTHING is applied by pasting into the SQL editor.
-- Every change is a numbered file in this directory, applied by the runner in
-- CI as the `yiwuflow_migrate` role. (ADR-0007)
-- =============================================================================

-- Marker table for the migration runner (created here so 0001 is idempotent
-- even before a runner library is wired up).
create table if not exists _migrations (
  version     integer primary key,
  name        text not null,
  applied_at  timestamptz not null default now()
);

insert into _migrations (version, name)
values (1, 'baseline')
on conflict (version) do nothing;
