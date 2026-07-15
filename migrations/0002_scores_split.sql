-- =============================================================================
-- 0002 — Split the escalation score (EXPAND phase — additive only)
--
-- The single monotonic escalation_score conflated two opposite meanings:
--   * problem  ("the AI is failing, a human should take over")  → must GATE the close
--   * lead     ("this client is buying, and buying big")        → must NEVER gate
--
-- Because high_value alone added +60 and order validation blocked at >= 70,
-- large orders permanently blocked their own confirmation. (ADR-0003 §3)
--
-- escalation_score is NOT dropped here. n8n still reads and writes it during
-- the shadow phase. It is removed by a contract migration only after n8n is
-- retired and the rollback window has closed. (ADR-0007, ADR-0009)
-- =============================================================================

alter table conversation_state
  add column if not exists problem_score integer not null default 0
    check (problem_score between 0 and 100),
  add column if not exists lead_score integer not null default 0
    check (lead_score between 0 and 100);

-- Conservative backfill: treat the old blended score as problem_score. This may
-- mark some hot leads as problems (they were being treated that way anyway);
-- it will never let a real problem through as a hot lead. Scores are recomputed
-- from signals on the next turn, so any error is transient. (ADR-0007)
update conversation_state
   set problem_score = least(greatest(escalation_score, 0), 100)
 where problem_score = 0
   and escalation_score is not null
   and escalation_score > 0;

-- Signals are the durable record; scores are derived from them (ADR-0003 §4).
create table if not exists conversation_signals (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references conversations(id) on delete cascade,
  business_id      uuid not null references businesses(id),
  kind             text not null check (kind in (
                     'human_requested','complaint','repeated_ambiguity',
                     'low_confidence_image','high_value','customization_requested',
                     'logistics_discussed','moq_accepted','price_acknowledged'
                   )),
  payload          jsonb not null default '{}',
  -- a resolved signal stops contributing to the score; it is not deleted,
  -- because it is also the audit trail
  resolved_at      timestamptz,
  created_at       timestamptz not null default now()
);

create index if not exists idx_signals_conversation_active
  on conversation_signals (conversation_id) where resolved_at is null;

insert into _migrations (version, name) values (2, 'scores_split')
on conflict (version) do nothing;
