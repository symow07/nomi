-- ---------------------------------------------------------------------------
-- 0089 — PRACTICE IS NOT KEPT (P6; the P1 decision in docs/PRACTICE.md).
--
-- "Try it" puts a real customer's question into Practice. Once there it is no
-- longer tied to that customer, so a deletion request (erase-buyer) cannot find
-- it. So Practice is not kept: "Start over" erases the workspace's practice
-- conversations at once, and a daily job erases any practice conversation
-- nothing has happened in for thirty days.
--
-- Erasure, not archiving: the app role has no DELETE, so both are definers.
--   · practice_start_over(live) — the workspace the caller is in, only; every
--     conversation on its copy (a copy holds practice and nothing else).
--   · practice_expire() — every copy; conversations whose newest message (or,
--     with none, their start) is more than thirty days old. It takes no
--     argument: nobody can ask it for less than thirty days.
-- Kept: the copy, its catalogue and rules (refreshed anyway), the practice
-- customer, and the workspace's own ledger. Erased: the conversations and all
-- that hangs off them — messages, turns, drafts, quotes, orders, events.
-- A practice job still queued for an erased conversation is dropped by the
-- worker (a job whose conversation is gone asks nothing of anyone).
--
-- The day's fifty practice lines (P5) are counted on the WORKSPACE's own row,
-- `practice_day` / `practice_lines`: counted from the practice transcript, as
-- P5 did, Start over — which now erases it — would give the day back.
-- ---------------------------------------------------------------------------

alter table businesses add column if not exists practice_day date;
alter table businesses add column if not exists practice_lines integer not null default 0;

create or replace function practice_erase(p_copy uuid, p_older_than interval) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[];
begin
  if not exists (select 1 from businesses where id = p_copy and practice_of is not null) then
    raise exception 'practice_erase: not a practice copy' using errcode = '42501';
  end if;
  select coalesce(array_agg(c.id), '{}') into v_ids
    from conversations c
   where c.business_id = p_copy
     and coalesce((select max(m.sent_at) from messages m where m.conversation_id = c.id), c.created_at)
         <= now() - p_older_than;
  if cardinality(v_ids) = 0 then return 0; end if;

  -- What points at a conversation without going with it, first.
  delete from promised_dates where conversation_id = any(v_ids);
  delete from deletion_asks where conversation_id = any(v_ids);
  delete from email_confirmations where order_id in (select id from orders where conversation_id = any(v_ids));
  delete from order_proposals where conversation_id = any(v_ids)
     or order_id in (select id from orders where conversation_id = any(v_ids));
  delete from orders where conversation_id = any(v_ids);
  delete from sequence_sends where outbound_id in (select id from outbound_messages where conversation_id = any(v_ids));
  delete from sequence_enrollments where conversation_id = any(v_ids);
  delete from deliveries where conversation_id = any(v_ids);
  delete from spot_checks where conversation_id = any(v_ids);
  delete from repairs where conversation_id = any(v_ids);
  delete from conversation_events where conversation_id = any(v_ids);
  if to_regclass('shadow.turn_decisions') is not null then
    execute 'delete from shadow.turn_decisions where conversation_id = any($1)' using v_ids;
  end if;
  -- The rest goes with the conversation (messages, turns, drafts, quotes, sends, signals, state…).
  delete from conversations where id = any(v_ids);
  return cardinality(v_ids);
end $$;
revoke all on function practice_erase(uuid, interval) from public;

create or replace function practice_start_over(p_live uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_copy uuid;
begin
  if p_live is null or p_live is distinct from current_business_id() then
    raise exception 'practice_start_over: only for the workspace you are in' using errcode = '42501';
  end if;
  select id into v_copy from businesses where practice_of = p_live;
  if v_copy is null then return 0; end if;
  return practice_erase(v_copy, interval '0');
end $$;
revoke all on function practice_start_over(uuid) from public;
grant execute on function practice_start_over(uuid) to nomi_app;

create or replace function practice_expire() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_copy uuid;
  v_n integer := 0;
begin
  for v_copy in select id from businesses where practice_of is not null loop
    v_n := v_n + practice_erase(v_copy, interval '30 days');
  end loop;
  return v_n;
end $$;
revoke all on function practice_expire() from public;
grant execute on function practice_expire() to nomi_app;

insert into _migrations (version, name) values (89, 'practice_erase')
on conflict (version) do nothing;
