-- ---------------------------------------------------------------------------
-- 0026 — the runtime role is `nomi_app`. The product has one name (B1).
--
-- READ THIS BEFORE APPLYING. Unlike every other migration in this repository,
-- the change it makes is visible to the RUNNING BUILD: `assertSafeRuntimeRole`
-- compares `current_user` at boot and refuses to serve on a mismatch. The
-- release BEFORE this one accepts both `nomi_app` and `yiwuflow_app`, which is
-- what lets the old build keep serving while this is applied and the connection
-- strings are updated. Applying 0026 against a build that predates that
-- transition release WILL take the deployment down until it is redeployed.
--
-- Order:
--   1. deploy the build that accepts either name  (RUNTIME_ROLE set)
--   2. apply THIS, then update DATABASE_URL and MIGRATE_DATABASE_URL
--   3. deploy the build that accepts `nomi_app` alone (REQUIRED_SCHEMA_VERSION 26)
--
-- NO POLICY IS TOUCHED, and none needs to be. `pg_policy` stores role OIDs, not
-- names, so every RLS policy written across 0005–0022 follows this rename
-- automatically. The integration suite proves that against a real database
-- rather than trusting the claim — see tests/integration/db.test.ts.
--
-- The applied migrations 0005–0022 still say `yiwuflow_app`. They are history
-- and are left alone (ADR-0007, forward-only): the role name in them is a
-- record of what was true when they ran.
--
-- THE PASSWORD TRAP. PostgreSQL salts an md5 password hash WITH THE ROLE NAME,
-- so renaming a role clears an md5 password. SCRAM-SHA-256 survives. The DO
-- block below reports which this installation uses; either way the password
-- must be set again out of band, because a migration must never contain one.
-- A cleared password fails as "cannot connect", which reads like a config
-- error and not like a rename — hence the notice.
-- ---------------------------------------------------------------------------

do $$
declare
  encoding text;
begin
  if not exists (select 1 from pg_roles where rolname = 'yiwuflow_app') then
    if exists (select 1 from pg_roles where rolname = 'nomi_app') then
      raise notice '0026: already renamed — nomi_app exists, nothing to do.';
      return;
    end if;
    raise exception '0026: neither yiwuflow_app nor nomi_app exists. Refusing to guess.';
  end if;

  -- BOTH exist. Roles are cluster-wide while databases and _migrations are not,
  -- so this is what a second database on the same cluster sees: another database
  -- renamed the role, and then THIS database's 0005 re-created the old name and
  -- granted its objects to it. Renaming is impossible (the name is taken) and
  -- adopting nomi_app would leave this database's grants on the wrong role.
  -- That is an operator decision about privileges, not something a migration
  -- may guess, so it stops with the two commands that resolve it.
  if exists (select 1 from pg_roles where rolname = 'nomi_app') then
    raise exception using
      message = '0026: both yiwuflow_app and nomi_app exist on this cluster.',
      detail  = 'Another database here has already been renamed; this one then '
                'recreated the old role and granted its objects to it.',
      hint    = 'Move the grants, then remove the duplicate: '
                'REASSIGN OWNED BY yiwuflow_app TO nomi_app; '
                'DROP OWNED BY yiwuflow_app; DROP ROLE yiwuflow_app; '
                'then re-run this migration.';
  end if;

  select case
           when rolpassword is null then 'none'
           when rolpassword like 'md5%' then 'md5'
           else 'scram'
         end into encoding
    from pg_authid where rolname = 'yiwuflow_app';

  alter role yiwuflow_app rename to nomi_app;

  if encoding = 'md5' then
    raise notice '0026: password was md5 and HAS BEEN CLEARED by the rename '
                 '(md5 is salted with the role name). Set it now: '
                 'ALTER ROLE nomi_app LOGIN PASSWORD ''<new>'';';
  elsif encoding = 'none' then
    raise notice '0026: role had no password. Set one before the app connects.';
  else
    raise notice '0026: password is scram-sha-256 and survived the rename. '
                 'Set it explicitly anyway if you are rotating.';
  end if;
end $$;

insert into _migrations (version, name) values (26, '0026_rename_runtime_role')
  on conflict (version) do nothing;
