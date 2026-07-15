-- =============================================================================
-- 0008 — Human inbox, claims policy, tenant budgets
--
-- Three subsystems, one principle: commitments and control move from prompts
-- into rows. (Priorities 3–5, 2026-07-15)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- (a) HUMAN INBOX. The AI already goes silent on handoff (assigned_to =
-- 'unclaimed'); this gives the silence a human workflow: who claimed, when,
-- SLA state, internal notes, and the release-with-summary that returns
-- control to the AI without contradicting what the human promised.
-- ---------------------------------------------------------------------------
create table if not exists agents (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id) on delete cascade,
  display_name  text not null,
  telegram_user_id text,          -- v1 bridge identity
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (business_id, telegram_user_id)
);

-- One row per handoff episode: the SLA timer and the audit trail.
create table if not exists handoffs (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references businesses(id),
  conversation_id   uuid not null references conversations(id) on delete cascade,
  reason            text not null,             -- problem_score / manual / approval
  requested_at      timestamptz not null default now(),
  sla_deadline_at   timestamptz not null,
  holding_sent_at   timestamptz,               -- the ONE deterministic holding msg
  claimed_at        timestamptz,
  claimed_by        uuid references agents(id),
  released_at       timestamptz,
  release_summary   text,                       -- agent-confirmed handover summary
  -- exactly one OPEN handoff per conversation (same invariant pattern as orders)
  constraint handoffs_open_unique exclude (conversation_id with =) where (released_at is null)
);
create index if not exists idx_handoffs_open on handoffs (business_id, requested_at)
  where released_at is null;

create table if not exists conversation_notes (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references businesses(id),
  conversation_id  uuid not null references conversations(id) on delete cascade,
  agent_id         uuid references agents(id),
  note             text not null,
  created_at       timestamptz not null default now()
);
create index if not exists idx_notes_conversation on conversation_notes (conversation_id, created_at);

-- Per-business inbox policy (SLA minutes, working hours later).
alter table businesses
  add column if not exists handoff_sla_minutes integer not null default 15;

-- ---------------------------------------------------------------------------
-- (b) CLAIMS POLICY. The numeral guard's sibling: numeral-free commitments
-- ("CE certified", "we ship DDP", "delivery guaranteed before Ramadan") are
-- exactly as binding as prices. DEFAULT-DENY: a claim class instance the
-- business has not explicitly allowed may never appear in an outbound message.
-- ---------------------------------------------------------------------------
create table if not exists claims_policy (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  kind         text not null check (kind in
                 ('certification','incoterm','payment_terms','guarantee',
                  'shipping_method','compliance','delivery_promise')),
  claim_key    text not null,        -- 'CE', 'DDP', 'net_30', 'food_grade', ...
  allowed      boolean not null default true,
  detail       jsonb not null default '{}',   -- e.g. {"cert_no":"...","expires":"2027-01"}
  unique (business_id, kind, claim_key)
);
create index if not exists idx_claims_business on claims_policy (business_id, kind);

-- Seed the demo business with the claims its seed catalog implies.
insert into claims_policy (business_id, kind, claim_key, allowed) values
  ('a0000000-0000-0000-0000-000000000001','payment_terms','deposit_30_70',true),
  ('a0000000-0000-0000-0000-000000000001','incoterm','FOB',true),
  ('a0000000-0000-0000-0000-000000000001','incoterm','EXW',true),
  ('a0000000-0000-0000-0000-000000000001','certification','food_grade',true) -- zip-lock bags are food-safe per catalog
on conflict (business_id, kind, claim_key) do nothing;

-- ---------------------------------------------------------------------------
-- (c) TENANT BUDGETS. A noisy tenant degrades only itself.
-- usage_ledger is also the pricing dataset you cannot backfill.
-- ---------------------------------------------------------------------------
create table if not exists usage_ledger (
  business_id   uuid not null references businesses(id) on delete cascade,
  day           date not null,
  llm_calls     integer not null default 0,
  input_tokens  bigint not null default 0,
  output_tokens bigint not null default 0,
  turns         integer not null default 0,
  primary key (business_id, day)
);

create table if not exists tenant_budgets (
  business_id        uuid primary key references businesses(id) on delete cascade,
  daily_llm_calls    integer not null default 2000,
  daily_tokens       bigint  not null default 5000000,
  soft_warn_pct      integer not null default 80,
  on_exceeded        text not null default 'throttle' check (on_exceeded in ('throttle','pause'))
);
insert into tenant_budgets (business_id) values ('a0000000-0000-0000-0000-000000000001')
on conflict (business_id) do nothing;

-- atomic increment, called once per turn from the worker
create or replace function record_usage(
  p_business_id uuid, p_llm_calls int, p_in bigint, p_out bigint)
returns void language sql set search_path = public as $$
  insert into usage_ledger (business_id, day, llm_calls, input_tokens, output_tokens, turns)
  values (p_business_id, current_date, p_llm_calls, p_in, p_out, 1)
  on conflict (business_id, day) do update set
    llm_calls = usage_ledger.llm_calls + excluded.llm_calls,
    input_tokens = usage_ledger.input_tokens + excluded.input_tokens,
    output_tokens = usage_ledger.output_tokens + excluded.output_tokens,
    turns = usage_ledger.turns + 1;
$$;

-- ---------------------------------------------------------------------------
-- RLS for everything new (same pattern; app role only).
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['agents','handoffs','conversation_notes','claims_policy','usage_ledger','tenant_budgets'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists tenant_isolation_app on %I', t);
    execute format(
      'create policy tenant_isolation_app on %I for all to yiwuflow_app using (business_id = current_business_id()) with check (business_id = current_business_id())', t);
  end loop;
end $$;

insert into _migrations (version, name) values (8, 'inbox_claims_budgets')
on conflict (version) do nothing;