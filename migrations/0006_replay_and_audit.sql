-- =============================================================================
-- 0006 — Replay & audit: the five Week-2 requirements, as tables
--
--   "Every decision must remain replayable."        → turns
--   "Every quote must remain reproducible."         → quotes (input snapshot)
--   "Every order must remain auditable."            → orders.quote_id + turns
--   "Every business fact traceable to SQL."         → quotes.inputs references rows
--   "Every outbound commitment deterministic."      → outbound references quote_id
--
-- The principle: an AI system's bugs are BEHAVIOURAL. You cannot attach a
-- debugger to a conversation that went wrong last Tuesday — unless you recorded
-- exactly what the engine saw and what it decided. Then replay IS the debugger:
-- feed state_before + input + analysis back through decideTurn (pure) and the
-- output must be byte-identical to what is recorded here. If it isn't, either
-- the code changed (diff the engine_version) or you found a bug.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- turns — one row per processed inbound message. The replay record.
-- ---------------------------------------------------------------------------
create table if not exists turns (
  message_id       text primary key,          -- external dedup key
  business_id      uuid not null references businesses(id),
  conversation_id  uuid not null references conversations(id) on delete cascade,

  -- exactly what decideTurn saw (its TurnInput, minus what lives elsewhere)
  state_before     jsonb not null,            -- ConversationState snapshot
  input            jsonb not null,            -- { text, extractedEmail, signalKinds }
  analysis         jsonb,                     -- LLM analysis (null on fast/injection path)
  retrieved        jsonb,                     -- product candidates shown to the model

  -- exactly what it decided
  decision         jsonb not null,            -- TurnDecision
  quote_id         uuid,                      -- fk added below (quotes defined next)

  -- provenance: WHICH engine, prompts, and model produced this
  engine           text not null default 'service' check (engine in ('n8n','service')),
  engine_version   text not null,             -- git sha / package version
  prompt_version   text,                      -- analysis prompt version used
  model_id         text,                      -- e.g. claude-sonnet-4-6

  latency_ms       integer,
  created_at       timestamptz not null default now()
);

create index if not exists idx_turns_conversation on turns (conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- quotes — every quote ever computed, with the FULL input snapshot.
--
-- Reproducible: computeQuote(inputs) must equal result, forever, regardless of
-- how price_tiers / pricing_policy / negotiation_rules have changed since.
-- Traceable: the snapshot rows carry the ids of the live rows they were read
-- from at compute time.
-- ---------------------------------------------------------------------------
create table if not exists quotes (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references businesses(id),
  conversation_id  uuid not null references conversations(id) on delete cascade,
  product_id       uuid not null references products(id),

  -- inputs, snapshotted at compute time
  quantity         integer not null,
  inputs           jsonb not null,   -- { tiers: [...], policy: {...}, rules: [...] }

  -- the deterministic result
  unit_price_usd   numeric(10,4) not null,
  discount_pct     numeric(5,2) not null default 0,
  total_usd        numeric(12,2) not null,
  requires_human   boolean not null default false,
  applied_rules    text[] not null default '{}',

  engine_version   text not null,
  created_at       timestamptz not null default now()
);

create index if not exists idx_quotes_conversation on quotes (conversation_id, created_at);

alter table turns
  add constraint turns_quote_fk foreign key (quote_id) references quotes(id);

-- Orders become auditable back to the exact quote that priced them.
alter table orders add column if not exists quote_id uuid references quotes(id);

-- ---------------------------------------------------------------------------
-- RLS for both (direct business_id policies, app role only).
-- ---------------------------------------------------------------------------
alter table turns enable row level security;
drop policy if exists tenant_isolation_app on turns;
create policy tenant_isolation_app on turns
  for all to yiwuflow_app
  using (business_id = current_business_id())
  with check (business_id = current_business_id());

alter table quotes enable row level security;
drop policy if exists tenant_isolation_app on quotes;
create policy tenant_isolation_app on quotes
  for all to yiwuflow_app
  using (business_id = current_business_id())
  with check (business_id = current_business_id());

insert into _migrations (version, name) values (6, 'replay_and_audit')
on conflict (version) do nothing;
