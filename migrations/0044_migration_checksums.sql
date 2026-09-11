-- ---------------------------------------------------------------------------
-- 0044 — G20: an applied migration that changed on disk is caught, not run.
--
-- WHAT WAS WRONG. `tools/migrate.mjs` decides what to apply by VERSION NUMBER
-- alone: a file whose number is already in `_migrations` is skipped, whatever
-- it now contains. So editing an applied migration — the ordinary temptation
-- when a column turns out to be the wrong type, and the ordinary thing a merge
-- does by accident — is silent. It applies on every clean database (a new
-- developer, a restored backup, CI) and on none of the old ones, and the two
-- diverge with nothing anywhere saying so. This is the class of defect this
-- repository keeps finding: two sources for one fact, agreeing until they do
-- not.
--
-- WHAT THIS ADDS. One nullable column holding the sha256 of the file as it was
-- applied. The runner records it when it applies a migration, backfills it for
-- rows that predate this one (their file is taken as the truth on the machine
-- that is already running it), and refuses to continue when a recorded
-- checksum and the file on disk disagree.
--
-- NULL means "applied before checksums existed", which is a statement about
-- history rather than a failure: it is backfilled on the next run, and only a
-- CHANGE after that point is an error.
--
-- Additive and forward-only (ADR-0007).
-- ---------------------------------------------------------------------------

alter table _migrations add column if not exists checksum text;

insert into _migrations (version, name) values (44, 'migration_checksums')
on conflict (version) do nothing;
