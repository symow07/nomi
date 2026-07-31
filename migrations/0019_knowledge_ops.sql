-- =============================================================================
-- 0019 — Factory Intelligence Operations (M14)
--
-- No new tables. The learning-operations layer is entirely READ MODELS over
-- data M13 already produces (turns, conversation_events knowledge_used,
-- product_knowledge, claims_policy). This migration only:
--   1. gives claims_policy timestamps, so "certifications authorised this week"
--      is answerable from real data (not invented);
--   2. adds the indexes the gap anti-join and the weekly aggregations need.
-- Additive and reversible.
-- =============================================================================

alter table claims_policy add column if not exists created_at timestamptz not null default now();
alter table claims_policy add column if not exists updated_at timestamptz not null default now();

-- Gap detection joins turns → conversation_events by (business_id, time) and by
-- event type; the weekly report groups turns by (business_id, time).
create index if not exists idx_turns_biz_created
  on turns (business_id, created_at desc);
create index if not exists idx_convevents_biz_type_created
  on conversation_events (business_id, type, created_at desc);

insert into _migrations (version, name) values (19, 'knowledge_ops')
on conflict (version) do nothing;
