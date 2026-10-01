-- 0106 — the ramp's rungs (R2, the onboarding plan's phase 6; decisions 9,
-- 12, 23).
--
--   · businesses.talks_earned_at / sells_earned_at — when a workspace that
--     signed itself up earned rung 1 (talks) and rung 2 (sells), stamped by
--     the counter (src/db/ramp.ts) as the owner decides drafts; cleared by the
--     system's own demotion of a capability in that rung, to be earned again.
--   · conversations.owner_testing — "this is me testing": the owner's own
--     test messages to their shop count toward nothing.
--   · earned_rung() — how far the switch may go for the CURRENT business, from
--     the workspace that pays (a practice copy mirrors it): 2 for a workspace
--     the operator made, or whose gate the operator lifted for a pilot (G7);
--     else the stamped rung; 0 outside a tenant. sending_alone_earned() (G4)
--     becomes "at least rung 1".

alter table businesses
  add column if not exists talks_earned_at timestamptz,
  add column if not exists sells_earned_at timestamptz;
alter table businesses drop constraint if exists businesses_sells_after_talks;
alter table businesses add constraint businesses_sells_after_talks
  check (sells_earned_at is null or talks_earned_at is not null);

alter table conversations add column if not exists owner_testing boolean not null default false;

create or replace function earned_rung() returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
             when p.signed_up_at is null then 2
             when p.auto_earned_by is not null and p.auto_earned_by <> 'ramp' then 2
             when p.sells_earned_at is not null then 2
             when p.talks_earned_at is not null then 1
             else 0 end
      from businesses me
      join businesses p on p.id = coalesce(me.practice_of, me.id)
     where me.id = current_business_id()), 0);
$$;
revoke all on function earned_rung() from public;
grant execute on function earned_rung() to nomi_app;

create or replace function sending_alone_earned() returns boolean
language sql stable security definer set search_path = public as $$
  select earned_rung() >= 1;
$$;

insert into _migrations (version, name) values (106, 'ramp')
on conflict (version) do nothing;
