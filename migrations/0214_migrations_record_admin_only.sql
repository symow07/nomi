-- 0214 — THE MIGRATION RECORD IS THE MIGRATOR'S ALONE (found 2026-10-01, KS5; fixed 2026-10-26, the owner's order).
--
-- 0005 granted the app role select, insert and update on every table that existed then, `_migrations` included
-- (0001). So the app could add a version it never ran — the boot guard (src/db/schemaVersion.ts) would then serve a
-- build against a schema that is not there — or rewrite a checksum, which is what G20 (0044) exists to catch.
-- The app only ever READS it (the boot guard, /health's schema line). Writing is the migrator's (tools/migrate.mjs,
-- the admin role).
--
-- tests/integration/app-role-writes.test.ts holds it: the app role is refused both writes, still reads the version,
-- and the tables it may write with no row security are exactly the three installation-wide ones, each named.

revoke insert, update, delete, truncate on _migrations from nomi_app;
grant select on _migrations to nomi_app;

insert into _migrations (version, name) values (214, 'migrations_record_admin_only')
  on conflict (version) do nothing;
