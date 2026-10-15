-- ---------------------------------------------------------------------------
-- 0167 — PRODUCTION BEHIND MAIN IS AN ALARM (the owner, 2026-10-15: "The
-- unexplained deploy stop is a pre-pilot blocker now. Not the stop itself —
-- the fact that nobody noticed for a day… Build the alarm: something that
-- compares main's HEAD against what production is actually running, and
-- reports when they diverge for more than an hour.")
--
-- From 2026-10-14 18:11 UTC Railway created no deployment for six merges, and
-- nothing said so. Now, every ten minutes, the running app compares the commit
-- it was deployed from (RAILWAY_GIT_COMMIT_SHA) with the head of `main` on
-- GitHub; a head that has not arrived an hour after it was merged is written
-- here, once, and the operator is told (src/pipeline/deployWatch.ts) — and
-- told again, once, when production catches up.
--
-- No workspace's data: commits only. The installation's own record.
-- ---------------------------------------------------------------------------

create table if not exists deploy_lag (
  main_sha      text primary key check (main_sha ~ '^[0-9a-f]{40}$'),
  running_sha   text check (running_sha is null or running_sha ~ '^[0-9a-f]{7,40}$'),
  main_at       timestamptz not null,
  noticed_at    timestamptz not null,
  alerted_at    timestamptz,
  caught_up_at  timestamptz
);

grant select, insert, update on deploy_lag to nomi_app;
revoke delete, truncate on deploy_lag from nomi_app;

insert into _migrations (version, name) values (167, 'deploy_lag')
  on conflict (version) do nothing;
