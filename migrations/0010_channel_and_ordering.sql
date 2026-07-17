-- =============================================================================
-- 0010 — Canonical channel ingress + delivery-ordered outbound + night windows
-- (ADR-0012 adoptions A/C/D + deliverable 6)
-- =============================================================================

-- (a) Canonical channel events: every provider webhook lands here first.
--     PK = provider's event id → dedup is a primary-key property (webhooks
--     retry for up to 7 days; every handler must be idempotent).
create table if not exists channel_events (
  id                text primary key,          -- e.g. wamid.HBgL...
  business_id       uuid not null references businesses(id),
  channel           text not null,             -- 'whatsapp'
  provider          text not null,             -- '360dialog'
  event_type        text not null,             -- 'message.inbound' | 'status'
  conversation_external_id text,               -- 'whatsapp:<buyer>:<merchant>'
  payload           jsonb not null,
  payload_sha256    text,
  occurred_at       timestamptz not null,
  received_at       timestamptz not null default now(),
  processed_at      timestamptz
);
create index if not exists idx_channel_events_pending
  on channel_events (received_at) where processed_at is null;

-- (b) Ordered outbound. WhatsApp does NOT guarantee delivery order; a message
--     that depends on its predecessor (e.g. quote after greeting) must wait for
--     the predecessor's 'delivered' status. seq is per-conversation.
create table if not exists outbound_messages (
  id                   uuid primary key default gen_random_uuid(),
  business_id          uuid not null references businesses(id),
  conversation_id      uuid not null references conversations(id) on delete cascade,
  seq                  integer not null,        -- per-conversation ordering
  body                 text not null,
  kind                 text not null default 'text',  -- 'text' | 'quote_card'
  requires_order       boolean not null default true, -- false = may overtake
  status               text not null default 'queued'
                         check (status in ('queued','sending','sent','delivered','read','failed','canceled')),
  provider_message_id  text unique,             -- correlate status webhooks
  attempts             integer not null default 0,
  last_error           text,
  created_at           timestamptz not null default now(),
  sent_at              timestamptz,
  delivered_at         timestamptz,
  unique (conversation_id, seq)
);
create index if not exists idx_outbound_sendable
  on outbound_messages (conversation_id, seq) where status = 'queued';

-- (c) Night-shift autonomy: a capability can be auto only inside a local-time
--     window (值夜班). null = no time restriction when mode='auto'.
alter table autonomy_policy
  add column if not exists time_window text;   -- 'HH:MM-HH:MM' in business tz

-- RLS (same pattern).
do $$
declare t text;
begin
  foreach t in array array['channel_events','outbound_messages'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists tenant_isolation_app on %I', t);
    execute format(
      'create policy tenant_isolation_app on %I for all to yiwuflow_app using (business_id = current_business_id()) with check (business_id = current_business_id())', t);
  end loop;
end $$;

insert into _migrations (version, name) values (10, 'channel_and_ordering')
on conflict (version) do nothing;
