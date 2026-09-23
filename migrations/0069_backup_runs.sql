-- 0069 · backup runs — the record the scheduled backup leaves behind.
--
-- backup/run.sh (a Railway cron service on the private network) dumps the
-- database once a day, restores the dump into a throwaway cluster and runs the
-- four restore checks, encrypts, uploads, and THEN writes one row here. The
-- app reads the table in two places:
--   · once a day (src/main.ts, QUEUES.backups): no row younger than 36 hours
--     means the owner is told, by e-mail and — where a channel is live — by
--     WhatsApp (src/core/ops/backups.ts, src/pipeline/notify.ts);
--   · Getting ready: "Backup tested" is checked for the owner from the newest
--     row whose drill passed, instead of a tick the owner had to make by hand.
--
-- Not tenant data: an installation has one backup, and every workspace is in
-- it. No business_id, no RLS; the app role may only SELECT. The job writes as
-- the admin role it dumps with.

create table if not exists backup_runs (
  id             bigserial primary key,
  name           text not null unique,             -- nomi-backup-<UTC>, the bucket prefix
  taken_at       timestamptz not null,             -- when the dump was taken
  uploaded_at    timestamptz not null default now(),
  dump_bytes     bigint not null check (dump_bytes > 0),
  sha256         text not null check (length(sha256) = 64),
  schema_version int not null,
  drill_passed   boolean not null,                 -- the four checks, in the backup container
  taken_by       text not null default 'railway-cron'
);

comment on table backup_runs is
  'One row per completed scheduled backup (backup/run.sh). Read daily by the app to alert the owner when none has completed for 36 h, and by Getting ready for "Backup tested".';

create index if not exists idx_backup_runs_uploaded on backup_runs (uploaded_at desc) where drill_passed;

-- The app role inherits insert/update on every new table (0005's default
-- privileges); here it may only READ. The job writes as the admin role.
revoke insert, update, delete on backup_runs from nomi_app;
grant select on backup_runs to nomi_app;

insert into _migrations (version, name) values (69, 'backup_runs')
on conflict (version) do nothing;
