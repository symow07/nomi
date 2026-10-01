-- 0103 — the operator's controls for a cohort of strangers (G7: the plan's
-- KS2, KS3, KS4 and KS6's stop flag).
--
--   · ops_flags learns 'connections_off': while it is on (for everyone, or
--     for one workspace) no channel can be connected — the Page connect and
--     WhatsApp's both refuse. Written by tools/ops-flags.mjs, read by the app
--     (row security: a workspace reads its own rows and the global ones).
--   · workspace_suspensions — what tools/suspend-workspace.mjs did to a
--     workspace, so --restore undoes exactly that and nothing else: the
--     silence row it wrote, whether the Page was healthy before it was marked
--     'refused', whether the workspace was active. Only the operator's admin
--     role touches it; the app role has no grant.

alter table ops_flags drop constraint if exists ops_flags_flag_check;
alter table ops_flags add constraint ops_flags_flag_check
  check (flag in ('global_silence', 'force_draft', 'silence_capability', 'practice_off', 'connections_off'));
alter table ops_flags drop constraint if exists ops_flags_check;
alter table ops_flags add constraint ops_flags_check
  check (flag in ('global_silence', 'practice_off', 'connections_off') or capability is not null);

create table if not exists workspace_suspensions (
  id            bigint generated always as identity primary key,
  business_id   uuid not null references businesses(id),
  reason        text not null check (length(btrim(reason)) between 1 and 500),
  suspended_by  text not null check (length(btrim(suspended_by)) between 1 and 120),
  suspended_at  timestamptz not null default now(),
  -- What this suspension changed, so a restore reverses only that.
  silence_flag_id  bigint,
  page_marked      boolean not null default false,
  was_active       boolean not null,
  restored_at   timestamptz,
  restored_by   text,
  check ((restored_at is null) = (restored_by is null))
);
create unique index if not exists workspace_suspensions_open
  on workspace_suspensions (business_id) where restored_at is null;
alter table workspace_suspensions enable row level security;
revoke all on workspace_suspensions from nomi_app;

-- Who opened sending alone for a workspace that signed itself up: 'ramp'
-- (R2) or the operator's name (tools/workspaces.mjs --earn, for a pilot).
alter table businesses add column if not exists auto_earned_by text
  check (auto_earned_by is null or length(btrim(auto_earned_by)) between 1 and 120);

-- The operator's daily list says which flags are on (KS4): every live row,
-- across workspaces, by name — row security would show the digest only the
-- global ones. Never a customer, never a message.
create or replace function active_ops_flags()
returns table (flag text, capability text, business text, set_at timestamptz)
language sql stable security definer set search_path = public as $$
  select f.flag, f.capability, b.name, f.set_at
    from ops_flags f left join businesses b on b.id = f.business_id
   where f.cleared_at is null
   order by f.set_at;
$$;
revoke all on function active_ops_flags() from public;
grant execute on function active_ops_flags() to nomi_app;

insert into _migrations (version, name) values (103, 'operator_controls')
on conflict (version) do nothing;
