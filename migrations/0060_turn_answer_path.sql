-- 0060 — N1: who answered each turn, and what it cost.
--
-- The product's direction is that she answers on her own power and falls back
-- to a model for a question she has never seen. `turns` is the replay record of
-- every turn and already says which model and prompt ran; it did not say WHO
-- WORDED the reply, how many model calls the turn made, or whether the first of
-- them bought anything. `usage_ledger` has the totals per day, which cannot
-- answer "which kind of message costs the money".
--
-- Every column is nullable: a turn recorded before this migration says nothing
-- about itself, and a report must count it as unknown rather than as free.

alter table turns
  add column if not exists answer_path        text,
  add column if not exists llm_calls          integer,
  add column if not exists input_tokens       integer,
  add column if not exists output_tokens      integer,
  add column if not exists analyser_avoidable boolean;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'turns_answer_path_check') then
    alter table turns add constraint turns_answer_path_check
      check (answer_path is null or answer_path in (
        'silent','handoff','fast_path','canned','order_flow',
        'order_status','taught_answer','stand_in','model'));
  end if;
end $$;

-- The report reads a business's recent turns by day.
create index if not exists idx_turns_business_created on turns (business_id, created_at);

insert into _migrations (version, name) values (60, 'turn_answer_path')
on conflict (version) do nothing;
