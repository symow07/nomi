-- =============================================================================
-- 0011 — M3: connection records, connection audit, outbound retry + transition
-- audit, encrypted credentials at rest. Additive only.
-- =============================================================================

-- (a) channels: one connection record per (business, kind). The owner-facing
--     对话渠道 card renders from this row + derived health.
create table if not exists channels (
  id                        uuid primary key default gen_random_uuid(),
  business_id               uuid not null references businesses(id) on delete cascade,
  kind                      text not null check (kind in
                              ('whatsapp','instagram','messenger','wechat','rednote',
                               'telegram','line','email','web_chat')),
  status                    text not null default 'disconnected' check (status in
                              ('connected','connecting','needs_attention','disconnected','degraded')),
  display_phone             text,
  credential_id             uuid references channel_credentials(id) on delete set null,
  last_inbound_at           timestamptz,
  last_delivered_at         timestamptz,
  last_webhook_at           timestamptz,
  consecutive_send_failures integer not null default 0,
  last_error                text,          -- internal diagnostics; never rendered to owners
  connected_at              timestamptz,
  disconnected_at           timestamptz,
  updated_at                timestamptz not null default now(),
  unique (business_id, kind)
);

-- (b) audit trail for connect / reconnect / disconnect / test / rotation.
--     detail carries fingerprints and outcomes — NEVER secret values.
create table if not exists channel_audit (
  id           bigint generated always as identity primary key,
  business_id  uuid not null references businesses(id) on delete cascade,
  channel_id   uuid references channels(id) on delete set null,
  action       text not null check (action in
                 ('connect','reconnect','disconnect','test','rotate_credential')),
  actor        text not null,              -- 'owner' | 'support' | 'system'
  detail       jsonb,
  at           timestamptz not null default now()
);
create index if not exists idx_channel_audit_channel on channel_audit (channel_id, at desc);

-- (c) outbound bookkeeping for retry, cancellation, and restart safety.
alter table outbound_messages
  add column if not exists origin           text not null default 'employee'
                             check (origin in ('employee','owner')),
  add column if not exists to_wa_id         text,
  add column if not exists next_retry_at    timestamptz,
  add column if not exists dead_lettered_at timestamptz,
  add column if not exists cancel_reason    text,
  add column if not exists sending_since    timestamptz,
  add column if not exists read_at          timestamptz;

create index if not exists idx_outbound_retry_due
  on outbound_messages (next_retry_at) where status = 'queued' and next_retry_at is not null;

-- (d) transition audit: every status change of every outbound message, with
--     the reconciliation verdict for ignored out-of-order/duplicate statuses.
create table if not exists outbound_transitions (
  id           bigint generated always as identity primary key,
  business_id  uuid not null references businesses(id) on delete cascade,
  outbound_id  uuid not null references outbound_messages(id) on delete cascade,
  from_status  text not null,
  to_status    text not null,              -- may equal from_status for ignored events
  detail       text,
  at           timestamptz not null default now()
);
create index if not exists idx_outbound_transitions_msg on outbound_transitions (outbound_id, at);

-- (e) encrypted credentials at rest (AES-256-GCM packed strings; key in env).
--     secret_ref stays for external secret stores; these columns make the
--     boring solo-scale path safe: a DB dump is not a credential dump.
alter table channel_credentials
  add column if not exists secret_ciphertext         text,
  add column if not exists webhook_secret_ciphertext text,
  add column if not exists secret_key_version        integer,
  add column if not exists secret_fingerprint        text;   -- sha256[:12] for audit only

-- RLS (same tenant-isolation pattern as everything else).
do $$
declare t text;
begin
  foreach t in array array['channels','channel_audit','outbound_transitions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists tenant_isolation_app on %I', t);
    execute format(
      'create policy tenant_isolation_app on %I for all to yiwuflow_app using (business_id = current_business_id()) with check (business_id = current_business_id())', t);
  end loop;
end $$;

-- Identity-sequence grants (0005's default privileges covered tables only).
grant usage on all sequences in schema public to yiwuflow_app;
alter default privileges in schema public
  grant usage on sequences to yiwuflow_app;

insert into _migrations (version, name) values (11, 'channels_health_security')
on conflict (version) do nothing;
