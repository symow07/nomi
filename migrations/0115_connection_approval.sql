-- 0115 — the operator approves each workspace's first connection (KS6; decision
-- 15; the plan's opening sequence).
--
-- One stranger's spam through Nomi's Meta app can get the app restricted, and
-- every workspace on it with it — Westlake included. From opening step 4 (open
-- sign-up), a workspace that signed itself up connects its first Page or
-- WhatsApp number only after the operator has looked at the business and its
-- Page. Step 5 turns it off once a month's numbers hold (no Meta strike, at
-- most 1 in 50 approved connections later suspended, the error alarm silent).
-- The pilots, and a workspace that has connected a channel before, are never
-- asked.
--
--   · ops_flags learns 'approve_connections' — for the whole installation only
--     (tools/ops-flags.mjs --set approve_connections --all).
--   · connection_approvals — one row per workspace: the owner's ask (where the
--     business can be seen: its Page, Instagram account or website), then the
--     operator's decision. It is the KS6 log the step 4 → 5 criteria are
--     measured by. The app reads its own row and asks through
--     ask_connection_approval(); only the operator decides
--     (tools/connections.mjs).
--   · connection_approval_needed() — for the current business.
--   · claim_connection_decisions() — the owner hears once, after a decision.
--   · connection_asks_waiting() — the count on the operator's daily list.

alter table ops_flags drop constraint if exists ops_flags_flag_check;
alter table ops_flags add constraint ops_flags_flag_check
  check (flag in ('global_silence', 'force_draft', 'silence_capability', 'practice_off', 'connections_off', 'approve_connections'));
alter table ops_flags drop constraint if exists ops_flags_check;
alter table ops_flags add constraint ops_flags_check
  check (flag in ('global_silence', 'practice_off', 'connections_off', 'approve_connections') or capability is not null);
alter table ops_flags drop constraint if exists ops_flags_approve_everyone;
alter table ops_flags add constraint ops_flags_approve_everyone
  check (flag <> 'approve_connections' or business_id is null);

create table if not exists connection_approvals (
  business_id uuid primary key references businesses(id) on delete cascade,
  page        text not null check (length(btrim(page)) between 3 and 300),
  asked_at    timestamptz not null default now(),
  asked_by    text not null check (length(btrim(asked_by)) between 1 and 120),
  decision    text check (decision in ('approved', 'refused')),
  decided_at  timestamptz,
  decided_by  text check (decided_by is null or length(btrim(decided_by)) between 1 and 120),
  -- The operator's own words, for the log. Never shown to the owner.
  note        text check (note is null or length(note) <= 500),
  told_at     timestamptz,
  check ((decision is null) = (decided_at is null)),
  check ((decision is null) = (decided_by is null))
);
alter table connection_approvals enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'connection_approvals' and policyname = 'connection_approvals_tenant') then
    create policy connection_approvals_tenant on connection_approvals for select to nomi_app
      using (business_id = current_business_id());
  end if;
end $$;
-- The schema's default privileges (0005) grant the app role every new table:
-- it may read its own row, and write only through the function below.
revoke all on connection_approvals from public, nomi_app;
grant select on connection_approvals to nomi_app;

-- The owner asks, once. A second ask changes nothing and says where it stands.
create or replace function ask_connection_approval(p_page text, p_by text)
returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  v_business uuid := current_business_id();
  v_decision text;
  v_found boolean;
begin
  if v_business is null then
    raise exception 'ask_connection_approval: no workspace' using errcode = '42501';
  end if;
  select true, decision into v_found, v_decision from connection_approvals where business_id = v_business;
  if v_found then
    return coalesce(v_decision, 'waiting');
  end if;
  insert into connection_approvals (business_id, page, asked_by) values (v_business, btrim(p_page), btrim(p_by));
  return 'asked';
end $$;
revoke all on function ask_connection_approval(text, text) from public;
grant execute on function ask_connection_approval(text, text) to nomi_app;

create or replace function connection_approval_needed()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from ops_flags where flag = 'approve_connections' and cleared_at is null)
     and coalesce((
       select b.signed_up_at is not null and b.practice_of is null
          and not exists (select 1 from connection_approvals a where a.business_id = b.id and a.decision = 'approved')
          -- Connected before, in any state since: never asked again.
          and not exists (select 1 from channels ch where ch.business_id = b.id and ch.kind = 'whatsapp')
          and not exists (select 1 from meta_accounts m where m.business_id = b.id)
         from businesses b where b.id = current_business_id()), false)
$$;
revoke all on function connection_approval_needed() from public;
grant execute on function connection_approval_needed() to nomi_app;

create or replace function claim_connection_decisions()
returns table (business_id uuid, decision text)
language sql volatile security definer set search_path = public as $$
  update connection_approvals a set told_at = now()
   where a.decision is not null and a.told_at is null
  returning a.business_id, a.decision;
$$;
revoke all on function claim_connection_decisions() from public;
grant execute on function claim_connection_decisions() to nomi_app;

create or replace function connection_asks_waiting()
returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from connection_approvals where decision is null
$$;
revoke all on function connection_asks_waiting() from public;
grant execute on function connection_asks_waiting() to nomi_app;

insert into _migrations (version, name) values (115, 'connection_approval')
on conflict (version) do nothing;
