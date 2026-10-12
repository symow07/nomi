-- ---------------------------------------------------------------------------
-- 0142 — D13 (the data-protection audit, 2026-10-12): A CUSTOMER'S ERASURE
-- REACHES THEIR WORDS IN PRACTICE.
--
-- Settled first (two audits read it differently): "Try it in Practice", on a
-- question the assistant could not answer, copies NOTHING by itself — it puts
-- the customer's question in the Practice box (`/app/sandbox?ask=`). When the
-- owner presses Send, the words are stored in the workspace's practice copy as
-- a practice conversation's message. From then on no customer erasure reached
-- them: Practice deletes a conversation only thirty days after it goes quiet
-- (or on Start over), and a practice conversation in use never goes quiet.
--
-- From here a customer's erasure also deletes every practice conversation in
-- the workspace's practice copy where one of their messages, or the text a
-- turn of theirs was made from (a question in the list is a turn's text), was
-- sent word for word. Texts shorter than twelve characters are not matched:
-- "hello" or "ok" is anyone's, and a practice conversation that only shares
-- one is the owner's own. A copy the owner edited is the owner's words.
--
--   · `practice_erase_conversations(copy, ids)` — 0135's practice deletion,
--     for given conversations; `practice_erase` (Start over, thirty days) now
--     calls it, unchanged in what it deletes.
--   · `erase_customer_rows` takes its words before anything goes and deletes
--     the practice conversations after; the count is `practice`, outside the
--     erased/kept/changed maps the operator tool plans and compares.
-- ---------------------------------------------------------------------------

create or replace function practice_erase_conversations(p_copy uuid, p_ids uuid[]) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[];
begin
  if not exists (select 1 from businesses where id = p_copy and practice_of is not null) then
    raise exception 'practice_erase_conversations: not a practice copy' using errcode = '42501';
  end if;
  v_ids := array(select id from conversations where business_id = p_copy and id = any(coalesce(p_ids, '{}'::uuid[])));
  if cardinality(v_ids) = 0 then return 0; end if;

  -- What points at a conversation without going with it, first (0135's order).
  delete from opt_outs o
   where o.business_id = p_copy
     and exists (select 1 from client_channels cc join conversations c on c.client_id = cc.client_id
                  where c.id = any(v_ids) and cc.channel = o.channel and cc.channel_user_id = o.identity);
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
revoke all on function practice_erase_conversations(uuid, uuid[]) from public;

-- 0135's practice_erase, the same conversations chosen the same way, deleted by the function above.
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
  return practice_erase_conversations(p_copy, v_ids);
end $$;
revoke all on function practice_erase(uuid, interval) from public;

do $$ begin
  if not exists (select 1 from pg_proc where proname = 'erase_customer_rows_kept') then
    alter function erase_customer_rows(uuid, uuid, uuid, boolean) rename to erase_customer_rows_kept;
  end if;
end $$;
revoke all on function erase_customer_rows_kept(uuid, uuid, uuid, boolean) from public;

-- The shortest text matched in Practice.
create or replace function practice_copy_min_length() returns integer language sql immutable as $$ select 12 $$;
revoke all on function practice_copy_min_length() from public;

create or replace function erase_customer_rows(p_business uuid, p_client uuid, p_request uuid, p_restored boolean default false)
returns jsonb
language plpgsql volatile security definer set search_path = public set row_security = off as $$
declare
  v_texts text[];
  v_copy uuid;
  v_convs uuid[];
  v_n integer := 0;
  v_counts jsonb;
begin
  -- What they said, before it goes: their messages, and the text each turn of theirs was made from.
  v_texts := array(select distinct btrim(x) from (
      select m.text_content as x from messages m join conversations c on c.id = m.conversation_id
       where c.client_id = p_client and c.business_id = p_business and m.direction = 'inbound' and m.text_content is not null
      union all
      select t.input->>'text' from turns t join conversations c on c.id = t.conversation_id
       where c.client_id = p_client and c.business_id = p_business and t.input->>'text' is not null
    ) s where length(btrim(x)) >= practice_copy_min_length());

  v_counts := erase_customer_rows_kept(p_business, p_client, p_request, p_restored);

  select id into v_copy from businesses where practice_of = p_business;
  if v_copy is not null and cardinality(v_texts) > 0 then
    v_convs := array(select distinct m.conversation_id from messages m join conversations c on c.id = m.conversation_id
                      where c.business_id = v_copy and m.direction = 'inbound' and btrim(m.text_content) = any(v_texts));
    v_n := practice_erase_conversations(v_copy, v_convs);
  end if;
  return case when v_n > 0 then v_counts || jsonb_build_object('practice', v_n) else v_counts end;
end $$;
revoke all on function erase_customer_rows(uuid, uuid, uuid, boolean) from public;

insert into _migrations (version, name) values (142, 'practice_copies')
  on conflict (version) do nothing;
