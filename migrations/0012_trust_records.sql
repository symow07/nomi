-- =============================================================================
-- 0012 — M5: trust records. capability_events makes silent authority changes
-- structurally impossible (the ONLY sanctioned way to flip autonomy_policy is
-- alongside an event row carrying reasons + evidence). spot_checks and repairs
-- feed promotion/demotion evidence. pilot_log captures Gate A observations.
-- Additive only.
-- =============================================================================

create table if not exists capability_events (
  id           bigint generated always as identity primary key,
  business_id  uuid not null references businesses(id) on delete cascade,
  capability   text not null check (capability in
                 ('greet','qualify','recommend','quote','negotiate','confirm_order','follow_up')),
  action       text not null check (action in
                 ('promote','pause','return_to_learning','withdraw','restore')),
  from_mode    text not null check (from_mode in ('draft','auto')),
  to_mode      text not null check (to_mode in ('draft','auto')),
  reasons      text[] not null default '{}',        -- DemotionReason / 'evidence_met'
  evidence     jsonb,                               -- CapabilityEvidence snapshot
  actor        text not null,                       -- 'owner' | 'system_suggested_owner_confirmed'
  at           timestamptz not null default now()
);
create index if not exists idx_capability_events_biz on capability_events (business_id, at desc);

create table if not exists spot_checks (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references businesses(id) on delete cascade,
  conversation_id  uuid references conversations(id) on delete set null,
  capability       text not null,
  work_ref         text,                            -- message/draft id being judged
  verdict          text check (verdict in ('correct','needs_improvement','serious')),
  correction       text,                            -- owner's short fix, if any
  asked_at         timestamptz not null default now(),
  answered_at      timestamptz
);
create index if not exists idx_spot_checks_biz on spot_checks (business_id, asked_at desc);

create table if not exists repairs (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references businesses(id) on delete cascade,
  conversation_id  uuid references conversations(id) on delete set null,
  capability       text not null,
  record           jsonb not null,                  -- RepairRecord (core/trust/repair.ts)
  status           text not null default 'open' check (status in
                     ('open','contained','corrected','verified','closed')),
  opened_at        timestamptz not null default now(),
  closed_at        timestamptz
);
create index if not exists idx_repairs_open on repairs (business_id) where status <> 'closed';

create table if not exists pilot_log (
  id             bigint generated always as identity primary key,
  business_id    uuid not null references businesses(id) on delete cascade,
  at             timestamptz not null,
  owner_label    text not null,
  surface        text not null,
  kind           text not null,
  event          text not null,
  owner_expected text not null default '',
  what_happened  text not null default '',
  owner_quote    text not null default '',
  severity       integer not null check (severity between 1 and 3),
  trust_impact   integer not null check (trust_impact between -2 and 2),
  suggested_fix  text not null default '',
  blocks_launch  boolean not null default false,
  status         text not null default 'new' check (status in
                   ('new','triaged','fixing','fixed','wont_fix')),
  linked_task    text
);

do $$
declare t text;
begin
  foreach t in array array['capability_events','spot_checks','repairs','pilot_log'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists tenant_isolation_app on %I', t);
    execute format(
      'create policy tenant_isolation_app on %I for all to yiwuflow_app using (business_id = current_business_id()) with check (business_id = current_business_id())', t);
  end loop;
end $$;

insert into _migrations (version, name) values (12, 'trust_records')
on conflict (version) do nothing;
