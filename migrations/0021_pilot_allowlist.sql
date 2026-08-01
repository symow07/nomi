-- =============================================================================
-- 0021 — M18.2: the pilot allowlist.
--
-- Between "messaging is switched on" and "any buyer can reach us" sits a
-- controlled window. While a channel is in pilot mode, outbound is permitted
-- ONLY to numbers the owner has explicitly listed. The rule is enforced in the
-- EXISTING send gate (core/channel/sendGate.ts) — the same place takeover and
-- pause suppression already live — so there is one refusal point, not a second.
--
-- FAIL-CLOSED by design: pilot_mode defaults to TRUE. A channel that is
-- activated without anyone thinking about the allowlist enforces it.
--
-- Additive only. Archive-not-erase: rows are archived, never deleted (the app
-- role has no DELETE anywhere).
-- =============================================================================

create table if not exists pilot_allowlist (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  -- Normalized by core/channel/phone.ts: digits only, no '+', no separators —
  -- the same shape as a WhatsApp wa_id, so comparison is exact.
  phone        text not null check (phone ~ '^[0-9]{7,15}$'),
  label        text,                        -- 'my phone', 'Ahmed — friendly buyer'
  added_by     text not null,
  added_at     timestamptz not null default now(),
  archived_at  timestamptz,                 -- archived ⇒ no longer allowed
  archived_by  text,
  unique (business_id, phone)
);

-- The send gate asks "is this number allowed for this tenant right now?"
create index if not exists idx_allowlist_active
  on pilot_allowlist (business_id, phone) where archived_at is null;

alter table pilot_allowlist enable row level security;
drop policy if exists tenant_isolation_app on pilot_allowlist;
create policy tenant_isolation_app on pilot_allowlist
  for all to yiwuflow_app
  using      (business_id = current_business_id())
  with check (business_id = current_business_id());
grant select, insert, update on pilot_allowlist to yiwuflow_app;

-- Pilot state lives on the channel: activation is a property of the channel,
-- not of the business. pilot_mode = the allowlist is enforced.
alter table channels add column if not exists pilot_mode   boolean not null default true;
alter table channels add column if not exists activated_at timestamptz;
alter table channels add column if not exists activated_by text;

-- Auditable refusals and activations. This list is CUMULATIVE — 0016 added
-- set_owner_phone and 0017 added update_profile, so it must be rebuilt from
-- 0017's set, not from 0011's. (Rewriting it from the original five silently
-- broke the settings save until it was caught.) M18 appends the activation
-- lifecycle, the allowlist changes, and the blocked-send record, so a refusal
-- is never a silent drop.
alter table channel_audit drop constraint if exists channel_audit_action_check;
alter table channel_audit add constraint channel_audit_action_check
  check (action in ('connect','reconnect','disconnect','test','rotate_credential',
                    'set_owner_phone','update_profile',
                    'activate','deactivate','blocked_not_allowlisted',
                    'allowlist_add','allowlist_archive'));

insert into _migrations (version, name) values (21, 'pilot_allowlist')
on conflict (version) do nothing;
