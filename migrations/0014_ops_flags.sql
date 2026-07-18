-- =============================================================================
-- 0014 — M8: kill switches. business_id null = platform-wide. A flag row can
-- only reduce authority (core/ops/killSwitch.ts is the sole interpreter and
-- is monotone by construction). Additive only.
-- =============================================================================

create table if not exists ops_flags (
  id           bigint generated always as identity primary key,
  business_id  uuid references businesses(id) on delete cascade,  -- null = global
  flag         text not null check (flag in
                 ('global_silence','force_draft','silence_capability')),
  capability   text check (capability in
                 ('greet','qualify','recommend','quote','negotiate','confirm_order','follow_up')),
  reason       text not null,
  set_by       text not null,
  set_at       timestamptz not null default now(),
  cleared_at   timestamptz,
  check (flag = 'global_silence' or capability is not null)
);
create index if not exists idx_ops_flags_active on ops_flags (business_id) where cleared_at is null;

alter table ops_flags enable row level security;
drop policy if exists tenant_isolation_app on ops_flags;
-- App role may READ its own + global flags; only ops (table owner) writes.
create policy tenant_read_app on ops_flags
  for select to yiwuflow_app
  using (business_id is null or business_id = current_business_id());

insert into _migrations (version, name) values (14, 'ops_flags')
on conflict (version) do nothing;
