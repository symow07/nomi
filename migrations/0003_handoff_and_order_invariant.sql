-- =============================================================================
-- 0003 — The handoff gate, and the money invariant
-- =============================================================================

-- (a) HANDOFF. In the n8n system, escalation fired a Telegram alert, set
-- phase='escalated' — and the AI kept replying, because nothing ever checked.
-- assigned_to non-null means a human owns the conversation and the AI MUST NOT
-- reply until control is explicitly returned (assigned_to set back to null).
-- The service enforces this at the top of the turn pipeline. (ADR-0003 §2)
alter table conversations
  add column if not exists assigned_to text,
  add column if not exists assigned_at timestamptz;

-- (b) ORDER IDEMPOTENCY. Two "yes" messages currently create two orders, two
-- Sheets rows, two confirmation emails: order_reference is unique but freshly
-- generated per run, so it never collides. The invariant belongs to the
-- DATABASE, not the queue — queues prevent concurrent duplicates, this prevents
-- ALL duplicates. (ADR-0004: every money operation gets a database invariant.)
--
-- Note: plain CREATE INDEX (not CONCURRENTLY) is correct here — pre-launch, no
-- traffic. Use CONCURRENTLY for any index added after go-live.
create unique index if not exists orders_one_open_per_conversation
  on orders (conversation_id)
  where status not in ('cancelled');

-- (c) OUTBOUND DELIVERY LEDGER. A SendGrid 502 currently loses the confirmation
-- email invisibly and forever. Every outbound side effect gets a row here;
-- the worker retries anything not 'delivered' and alerts on exhaustion.
create table if not exists deliveries (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references businesses(id),
  conversation_id  uuid references conversations(id) on delete set null,
  kind             text not null check (kind in
                     ('channel_reply','email','telegram_alert','sheet_append','webhook')),
  payload          jsonb not null,
  status           text not null default 'pending'
                     check (status in ('pending','delivered','failed','dead')),
  attempts         integer not null default 0,
  last_error       text,
  next_attempt_at  timestamptz,
  delivered_at     timestamptz,
  created_at       timestamptz not null default now()
);

create index if not exists idx_deliveries_pending
  on deliveries (next_attempt_at) where status in ('pending','failed');

insert into _migrations (version, name) values (3, 'handoff_and_order_invariant')
on conflict (version) do nothing;
