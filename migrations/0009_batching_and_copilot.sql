-- =============================================================================
-- 0009 — Inbound batching + copilot (draft) mode
-- =============================================================================

-- (a) Fragments: raw inbound pieces awaiting merge into one turn.
--     Persisted => replay is free and dedup is a primary-key property.
create table if not exists message_fragments (
  id               text primary key,            -- external message id
  business_id      uuid not null references businesses(id),
  conversation_id  uuid not null references conversations(id) on delete cascade,
  text             text not null,
  received_at      timestamptz not null default now(),
  processed_in     text references turns(message_id)   -- null = pending
);
create index if not exists idx_fragments_pending
  on message_fragments (conversation_id, received_at) where processed_in is null;

-- Per-tenant batching knobs (buyers type differently per market/channel).
alter table businesses
  add column if not exists batch_debounce_ms integer not null default 6000,
  add column if not exists batch_max_window_ms integer not null default 20000,
  add column if not exists batch_max_fragments integer not null default 8;

-- (b) COPILOT MODE. The trust ladder: the AI's output is a DRAFT until the
--     owner's approvals earn each capability autonomy.
--     Modes: 'draft' = human approves everything; 'auto' = AI sends directly.
create table if not exists autonomy_policy (
  business_id  uuid not null references businesses(id) on delete cascade,
  capability   text not null check (capability in
                 ('greet','qualify','recommend','quote','negotiate','confirm_order','follow_up')),
  mode         text not null default 'draft' check (mode in ('draft','auto')),
  -- promotion evidence: how many consecutive unedited approvals before
  -- suggesting auto. Suggestion only — the OWNER flips the switch.
  auto_after_clean_approvals integer not null default 20,
  updated_at   timestamptz not null default now(),
  primary key (business_id, capability)
);

-- Every business starts fully draft — trust is earned, not defaulted.
insert into autonomy_policy (business_id, capability)
select b.id, c.capability
from businesses b
cross join (values ('greet'),('qualify'),('recommend'),('quote'),
                   ('negotiate'),('confirm_order'),('follow_up')) as c(capability)
on conflict (business_id, capability) do nothing;

create table if not exists drafts (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references businesses(id),
  conversation_id  uuid not null references conversations(id) on delete cascade,
  turn_message_id  text references turns(message_id),
  capability       text not null,
  draft_text       text not null,               -- what the AI proposed
  status           text not null default 'pending'
                     check (status in ('pending','approved','edited','rejected','expired')),
  sent_text        text,                        -- what actually went out
  decided_by       uuid references agents(id),
  decided_at       timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists idx_drafts_pending
  on drafts (business_id, created_at) where status = 'pending';

-- THE LEARNING ASSET: an edit is a labeled correction. draft_text vs sent_text
-- diffs feed the golden set, prompt tuning, and eventually fine-tuning.
-- (No separate table needed — the pair lives on the draft row; this view is
-- the training-example export.)
create or replace view training_examples as
select business_id, conversation_id, capability,
       draft_text as model_output, sent_text as human_corrected,
       (status = 'approved') as accepted_verbatim,
       decided_at
from drafts
where status in ('approved','edited');

-- RLS for the new tables.
do $$
declare t text;
begin
  foreach t in array array['message_fragments','autonomy_policy','drafts'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists tenant_isolation_app on %I', t);
    execute format(
      'create policy tenant_isolation_app on %I for all to yiwuflow_app using (business_id = current_business_id()) with check (business_id = current_business_id())', t);
  end loop;
end $$;

insert into _migrations (version, name) values (9, 'batching_and_copilot')
on conflict (version) do nothing;
