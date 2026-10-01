-- 0116 — retention: a workspace that never connected a channel goes after 90
-- days, after warning e-mails (RET; the plan's phase 7c).
--
-- A stranger who signs up, looks around and never connects anything leaves a
-- business's name, its owner's address and whatever was typed into Practice
-- behind for good. RET ends that: 90 days after sign-up, a workspace that has
-- never connected WhatsApp, a Page or a mailbox is erased — but only after two
-- warnings, the first at least 14 days before the date.
--
-- OFF BY DEFAULT. An automatic erasure is the owner's to turn on: nothing here
-- warns or erases until the ops flag 'retention' is set for the installation
-- (tools/ops-flags.mjs --set retention --all). Even then the app only warns;
-- the erasure is the operator's command (tools/retention.mjs), through
-- tools/erase-workspace.mjs, under a workspace deletion request it records.
--
--   · retention_notices — the warnings sent: '14d' then '3d', each once.
--   · retention_workspaces() — every candidate, its erase date and the
--     warnings it has had; empty while the switch is off.
--   · claim_retention_warnings() — the warnings due now, written as they are
--     returned, so two sweeps never send one twice.
--
-- The erase date is never earlier than 14 days after the first warning, nor
-- than 3 days after the second: a switch turned on late, or a daily job that
-- missed days, cannot erase a workspace the week (or the day) its owner hears.

alter table ops_flags drop constraint if exists ops_flags_flag_check;
alter table ops_flags add constraint ops_flags_flag_check
  check (flag in ('global_silence', 'force_draft', 'silence_capability', 'practice_off', 'connections_off', 'approve_connections', 'retention'));
alter table ops_flags drop constraint if exists ops_flags_check;
alter table ops_flags add constraint ops_flags_check
  check (flag in ('global_silence', 'practice_off', 'connections_off', 'approve_connections', 'retention') or capability is not null);
alter table ops_flags drop constraint if exists ops_flags_retention_everyone;
alter table ops_flags add constraint ops_flags_retention_everyone
  check (flag <> 'retention' or business_id is null);

create table if not exists retention_notices (
  business_id uuid not null references businesses(id) on delete cascade,
  stage       text not null check (stage in ('14d', '3d')),
  sent_at     timestamptz not null default now(),
  -- The date the warning named, so the operator's list and the e-mail agree.
  erase_on    date not null,
  primary key (business_id, stage)
);
alter table retention_notices enable row level security;
-- The schema's default privileges (0005) grant the app role every new table:
-- taken back; the app reaches it only through the functions below.
revoke all on retention_notices from public, nomi_app;

create or replace function retention_workspaces()
returns table (business_id uuid, name text, signed_up_at timestamptz, erase_on date, warned_14d boolean, warned_3d boolean, due boolean)
language sql stable security definer set search_path = public as $$
  with on_ as (select exists (select 1 from ops_flags where flag = 'retention' and cleared_at is null) as on_),
  c as (
    select b.id, b.name, b.signed_up_at,
           (select n.sent_at from retention_notices n where n.business_id = b.id and n.stage = '14d') as first_at,
           (select n.sent_at from retention_notices n where n.business_id = b.id and n.stage = '3d') as second_at
      from businesses b, on_
     where on_.on_
       and b.signed_up_at is not null and b.practice_of is null
       -- Never connected anything, in any state since.
       and not exists (select 1 from channels ch where ch.business_id = b.id and ch.kind = 'whatsapp')
       and not exists (select 1 from meta_accounts m where m.business_id = b.id)
       and not exists (select 1 from mail_accounts a where a.business_id = b.id)
       -- A workspace request already open is the operator's in hand.
       and not exists (select 1 from deletion_requests r where r.business_id = b.id and r.scope = 'workspace' and r.state = 'open')
  )
  , e as (
    -- greatest() passes over the null of a warning not yet sent.
    select c.*, greatest((c.signed_up_at + interval '90 days')::date, (coalesce(c.first_at, now()) + interval '14 days')::date,
                         (c.second_at + interval '3 days')::date) as erase_on
      from c)
  select e.id, e.name, e.signed_up_at, e.erase_on, e.first_at is not null, e.second_at is not null,
         e.first_at is not null and e.second_at is not null and now()::date >= e.erase_on
    from e
   order by e.signed_up_at;
$$;
revoke all on function retention_workspaces() from public;
grant execute on function retention_workspaces() to nomi_app;

-- '14d' from day 76; '3d' from three days before the date the first one named.
create or replace function claim_retention_warnings()
returns table (business_id uuid, stage text, erase_on date)
language plpgsql volatile security definer set search_path = public as $$
begin
  return query
  with w as (select * from retention_workspaces()),
  first_ as (
    insert into retention_notices as n (business_id, stage, erase_on)
    select w.business_id, '14d', w.erase_on from w
     where not w.warned_14d and now() >= w.signed_up_at + interval '76 days'
    on conflict (business_id, stage) do nothing
    returning n.business_id, n.stage, n.erase_on),
  second_ as (
    insert into retention_notices as n (business_id, stage, erase_on)
    select w.business_id, '3d', greatest(w.erase_on, now()::date + 3) from w
     where w.warned_14d and not w.warned_3d and now()::date >= w.erase_on - 3
    on conflict (business_id, stage) do nothing
    returning n.business_id, n.stage, n.erase_on)
  select * from first_ union all select * from second_;
end $$;
revoke all on function claim_retention_warnings() from public;
grant execute on function claim_retention_warnings() to nomi_app;

insert into _migrations (version, name) values (116, 'retention')
on conflict (version) do nothing;
