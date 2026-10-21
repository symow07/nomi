-- ---------------------------------------------------------------------------
-- 0197 — A LABEL ON A BUYER GOES WITH THE BUYER (Phase 5, S2; 0196's labels in the customer erasure, 0126).
--
-- The customer erasure follows only the links written into it (`customer_erasure_edges`): a new one makes it refuse,
-- by name, until it is decided. `buyer_labels.client_id → clients.id` is decided here: a label put on a buyer is the
-- buyer's, and is erased with them — the label itself, the workspace's own word, stays.
-- ---------------------------------------------------------------------------

-- The links the erasure follows, re-made from their latest definition (0130) with the new one.
create or replace function customer_erasure_edges()
returns table (child text, col text, parent text, pcol text)
language sql immutable set search_path = public as $$
  values
    ('client_channels', 'client_id', 'clients', 'id'),
    ('client_faces', 'client_id', 'clients', 'id'),
    -- 0196 (S2) — a label on a buyer: theirs.
    ('buyer_labels', 'client_id', 'clients', 'id'),
    ('conversations', 'client_id', 'clients', 'id'),
    ('customers_answered', 'client_id', 'clients', 'id'),
    ('deletion_asks', 'client_id', 'clients', 'id'),
    ('deletion_requests', 'client_id', 'clients', 'id'),
    ('order_proposals', 'client_id', 'clients', 'id'),
    ('orders', 'client_id', 'clients', 'id'),
    ('conversation_notes', 'conversation_id', 'conversations', 'id'),
    ('conversation_signals', 'conversation_id', 'conversations', 'id'),
    ('conversation_state', 'conversation_id', 'conversations', 'id'),
    ('deletion_asks', 'conversation_id', 'conversations', 'id'),
    ('deliveries', 'conversation_id', 'conversations', 'id'),
    ('drafts', 'conversation_id', 'conversations', 'id'),
    ('escalation_events', 'conversation_id', 'conversations', 'id'),
    ('handoffs', 'conversation_id', 'conversations', 'id'),
    ('message_fragments', 'conversation_id', 'conversations', 'id'),
    ('messages', 'conversation_id', 'conversations', 'id'),
    ('order_proposals', 'conversation_id', 'conversations', 'id'),
    ('orders', 'conversation_id', 'conversations', 'id'),
    ('outbound_messages', 'conversation_id', 'conversations', 'id'),
    ('promised_dates', 'conversation_id', 'conversations', 'id'),
    ('quote_proofs', 'conversation_id', 'conversations', 'id'),
    ('quotes', 'conversation_id', 'conversations', 'id'),
    ('repairs', 'conversation_id', 'conversations', 'id'),
    ('sample_requests', 'conversation_id', 'conversations', 'id'),
    ('sequence_enrollments', 'conversation_id', 'conversations', 'id'),
    ('spot_checks', 'conversation_id', 'conversations', 'id'),
    ('turns', 'conversation_id', 'conversations', 'id'),
    ('conversation_events', 'conversation_id', 'conversations', 'id'),
    ('shadow.turn_decisions', 'conversation_id', 'conversations', 'id'),
    ('deletion_asks', 'message_id', 'messages', 'id'),
    ('deletion_asks', 'request_id', 'deletion_requests', 'id'),
    ('drafts', 'turn_message_id', 'turns', 'message_id'),
    ('message_fragments', 'processed_in', 'turns', 'message_id'),
    ('email_confirmations', 'order_id', 'orders', 'id'),
    ('order_proposals', 'order_id', 'orders', 'id'),
    ('order_updates', 'order_id', 'orders', 'id'),
    ('orders', 'quote_id', 'quotes', 'id'),
    ('quote_proofs', 'quote_id', 'quotes', 'id'),
    ('turns', 'quote_id', 'quotes', 'id'),
    ('outbound_transitions', 'outbound_id', 'outbound_messages', 'id'),
    ('promised_dates', 'outbound_id', 'outbound_messages', 'id'),
    ('sequence_sends', 'outbound_id', 'outbound_messages', 'id'),
    ('sequence_sends', 'enrollment_id', 'sequence_enrollments', 'id'),
    -- 0130 — the advisor's link to each customer a turn named.
    ('advisor_turn_subjects', 'client_id', 'clients', 'id')
$$;
revoke all on function customer_erasure_edges() from public;

-- The customer's erasure, then their labels.
do $$ begin
  if not exists (select 1 from pg_proc where proname = 'erase_customer_rows_proforma') then
    alter function erase_customer_rows(uuid, uuid, uuid, boolean) rename to erase_customer_rows_proforma;
  end if;
end $$;
revoke all on function erase_customer_rows_proforma(uuid, uuid, uuid, boolean) from public;

-- erase_customer_rows, re-made from its latest definition (0151), which runs first, unchanged, as _proforma.
create or replace function erase_customer_rows(p_business uuid, p_client uuid, p_request uuid, p_restored boolean default false)
returns jsonb
language plpgsql volatile security definer set search_path = public set row_security = off as $$
declare
  v_counts jsonb;
  v_n bigint;
begin
  v_counts := erase_customer_rows_proforma(p_business, p_client, p_request, p_restored);
  delete from buyer_labels where client_id = p_client and business_id = p_business;
  get diagnostics v_n = row_count;
  if exists (select 1 from buyer_labels where client_id = p_client) then
    raise exception 'erasure: a label is still on the erased customer. Rolled back; nothing changed.' using errcode = 'NE010';
  end if;
  -- counted with the rest of what was erased (the ledger and the closed request's note read `erased`)
  return jsonb_set(v_counts, '{erased}', erasure_add(coalesce(v_counts -> 'erased', '{}'::jsonb), 'buyer_labels', v_n));
end $$;
revoke all on function erase_customer_rows(uuid, uuid, uuid, boolean) from public;

insert into _migrations (version, name) values (197, 'labels_erasure')
  on conflict (version) do nothing;
