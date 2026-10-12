-- ---------------------------------------------------------------------------
-- 0141 — D12 (the data-protection audit, 2026-10-12): EVERY ERASURE'S LEDGER
-- LINE REACHES THE OPERATOR'S MAILBOX.
--
-- After a restore, every deletion made since that backup is carried out again
-- (tools/replay-erasures.mjs) from the ledger lines that still exist: the live
-- database if it answers, the newest backup, and the operator's mailbox. The
-- mailbox is the copy that outlives a total loss — and only an owner's own
-- customer erasure or closing was ever mailed. The advisor's deletions, the
-- twelve-month expiry, a team member's history going with them, and every
-- erasure an operator's tool carried out never reached it.
--
-- `erasure_ledger_mailed` notes each line the operator was sent; a job every
-- fifteen minutes mails the rest (ids only, as the ledger holds them) and
-- notes them only once the mail went — a mail that failed is tried again. The
-- app's immediate mails note their lines too, so nothing is mailed twice. The
-- app role reaches both through two functions and reads neither table.
-- ---------------------------------------------------------------------------

create table if not exists erasure_ledger_mailed (
  ledger_id uuid primary key,
  mailed_at timestamptz not null default now()
);
alter table erasure_ledger_mailed enable row level security;
revoke all on erasure_ledger_mailed from public, nomi_app;

-- The lines not yet mailed, oldest first. A line younger than five minutes
-- waits: the app's own mail for it may still be on its way.
create or replace function erasure_ledger_unmailed(p_limit integer default 200) returns setof jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(l.*) from erasure_ledger l
   where not exists (select 1 from erasure_ledger_mailed m where m.ledger_id = l.id)
     and l.at < now() - interval '5 minutes'
   order by l.at, l.id
   limit greatest(1, least(coalesce(p_limit, 200), 1000))
$$;
revoke all on function erasure_ledger_unmailed(integer) from public;
grant execute on function erasure_ledger_unmailed(integer) to nomi_app;

create or replace function erasure_ledger_mark_mailed(p_ids uuid[]) returns integer
language plpgsql volatile security definer set search_path = public as $$
declare n integer;
begin
  insert into erasure_ledger_mailed (ledger_id)
  select x from unnest(coalesce(p_ids, '{}'::uuid[])) x
   where exists (select 1 from erasure_ledger l where l.id = x)
  on conflict (ledger_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function erasure_ledger_mark_mailed(uuid[]) from public;
grant execute on function erasure_ledger_mark_mailed(uuid[]) to nomi_app;

-- What is already in the ledger stays where it is (the live database and every
-- backup hold it): marked, so the first run is not a flood of old lines.
insert into erasure_ledger_mailed (ledger_id) select id from erasure_ledger on conflict do nothing;

insert into _migrations (version, name) values (141, 'ledger_mail')
  on conflict (version) do nothing;
