-- ---------------------------------------------------------------------------
-- 0140 — D10 (the data-protection audit, 2026-10-12): WHAT IS KEPT AFTER AN
-- ERASURE NO LONGER DESCRIBES THEM.
--
-- A customer's erasure keeps a few rows on purpose: their orders (the
-- business's books), the request (the record that they asked), a
-- do-not-contact entry and a standing stop (so they are never written to
-- again). Those rows still said who they were:
--   · the request's own note — "the WhatsApp number ending 4471";
--   · an order's tracking number, and each order update's note and tracking
--     number — a parcel addressed to them;
--   · a do-not-contact entry's free-text detail;
--   · a stop they later took back (`opt_outs.lifted_at`): it protects nobody
--     any more, and kept their channel account and the dates.
-- From here the erasure clears the first three and deletes the fourth; a
-- standing stop stays, like the do-not-contact entry, now counted as kept
-- (the operator tool counted it and the database did not, so an erasure of
-- anyone with a standing stop would have stopped on "disagree").
--
-- The 0130 wrapper keeps its body under a new name; this one takes the name
-- every caller uses (carry_out_customer_request, tools/replay-erasures.mjs),
-- reads who they are BEFORE the erasure takes their accounts, and cleans the
-- kept rows after. tools/erase-buyer.mjs's RULES and this contract stay one
-- list (contractDifferences): 'keep-standing' and 'any-identity' are new words
-- in both.
-- ---------------------------------------------------------------------------

do $$ begin
  if not exists (select 1 from pg_proc where proname = 'erase_customer_rows_advisor') then
    alter function erase_customer_rows(uuid, uuid, uuid, boolean) rename to erase_customer_rows_advisor;
  end if;
end $$;
revoke all on function erase_customer_rows_advisor(uuid, uuid, uuid, boolean) from public;

create or replace function erase_customer_rows(p_business uuid, p_client uuid, p_request uuid, p_restored boolean default false)
returns jsonb
language plpgsql volatile security definer set search_path = public set row_security = off as $$
declare
  v_ch text[]; v_val text[];
  v_mp_ch text[]; v_mp_val text[];
  v_lifted uuid[]; v_standing uuid[]; v_supp uuid[];
  v_orders uuid[];
  v_n bigint;
  v_counts jsonb;
begin
  -- Who they are, before their accounts go: the four places the erasure reads,
  -- every channel, normalised and as written (the core's own reading).
  select coalesce(array_agg(s.ch order by s.ch, s.val), '{}'), coalesce(array_agg(s.val order by s.ch, s.val), '{}')
    into v_ch, v_val
    from (
      select distinct r.channel as ch, x.val
        from (
          select cc.channel, cc.channel_user_id as identity from client_channels cc
            join clients c on c.id = cc.client_id where cc.client_id = p_client and c.business_id = p_business
          union select 'whatsapp', phone from clients where id = p_client and business_id = p_business and phone is not null
          union select 'email', email from clients where id = p_client and business_id = p_business and email is not null
          union select 'email', client_email from orders where client_id = p_client and business_id = p_business and client_email is not null
          union select v.channel, o.to_wa_id from outbound_messages o join conversations v on v.id = o.conversation_id
                 where v.client_id = p_client and v.business_id = p_business and o.to_wa_id is not null
        ) r
        cross join lateral (values (erasure_identity(r.channel, r.identity)), (erasure_trim(r.identity))) x(val)
       where x.val is not null and x.val <> ''
    ) s;
  select coalesce(array_agg(c), '{}'), coalesce(array_agg(v), '{}') into v_mp_ch, v_mp_val
    from unnest(v_ch, v_val) i(c, v) where c in ('whatsapp', 'email');

  -- A stop is theirs on whichever channel they asked on; a do-not-contact entry
  -- as the core finds it (their number or address).
  v_lifted := array(select o.id from opt_outs o where o.business_id = p_business and o.lifted_at is not null and exists (
                select 1 from unnest(v_ch, v_val) i(c, v) where i.c = o.channel and (o.identity = i.v or (i.c = 'email' and lower(o.identity) = i.v))));
  v_standing := array(select o.id from opt_outs o where o.business_id = p_business and o.lifted_at is null and exists (
                select 1 from unnest(v_ch, v_val) i(c, v) where i.c = o.channel and (o.identity = i.v or (i.c = 'email' and lower(o.identity) = i.v))));
  v_supp := array(select x.id from suppressions x where x.business_id = p_business and exists (
                select 1 from unnest(v_mp_ch, v_mp_val) i(c, v) where i.c = x.channel and (x.identity = i.v or (i.c = 'email' and lower(x.identity) = i.v))));

  v_counts := erase_customer_rows_advisor(p_business, p_client, p_request, p_restored);

  -- What is kept stops describing them.
  v_orders := array(select o.id from orders o where o.business_id = p_business
                      and (o.client_id = p_client or o.conversation_id in (select id from conversations where client_id = p_client)));
  update orders set tracking_reference = null where id = any(v_orders) and tracking_reference is not null;
  update order_updates set note = null, tracking_reference = null
   where order_id = any(v_orders) and (note is not null or tracking_reference is not null);
  update deletion_requests set subject_note = null
   where business_id = p_business and client_id = p_client and subject_note is not null;
  update suppressions set detail = null where id = any(v_supp) and detail is not null;
  delete from opt_outs where id = any(v_lifted);
  get diagnostics v_n = row_count; perform erasure_expect('opt_outs', v_n, cardinality(v_lifted)::bigint);

  if exists (select 1 from orders where id = any(v_orders) and tracking_reference is not null)
     or exists (select 1 from order_updates where order_id = any(v_orders) and (note is not null or tracking_reference is not null))
     or exists (select 1 from deletion_requests where business_id = p_business and client_id = p_client and subject_note is not null)
     or exists (select 1 from suppressions where id = any(v_supp) and detail is not null) then
    raise exception 'erasure: a kept row still describes this customer after the erasure. Rolled back; nothing changed.' using errcode = 'NE010';
  end if;

  v_counts := jsonb_set(v_counts, '{erased}', erasure_add(coalesce(v_counts->'erased', '{}'::jsonb), 'opt_outs', cardinality(v_lifted)::bigint));
  return jsonb_set(v_counts, '{kept}', erasure_add(coalesce(v_counts->'kept', '{}'::jsonb), 'opt_outs', cardinality(v_standing)::bigint));
end $$;
revoke all on function erase_customer_rows(uuid, uuid, uuid, boolean) from public;

-- The contract: 0135's, with the kept rows' new cleared columns and the stop's own rule.
create or replace function customer_erasure_contract()
returns table (tbl text, action text, clear text[], blank text[], detach text[], match text)
language sql immutable set search_path = public as $$
  values
    ('clients', 'anonymise', array['display_name','email','phone','country','preferred_language','notes'], null::text[], null::text[], null::text),
    ('client_channels', 'erase', null, null, null, null),
    ('conversations', 'shell', array['assigned_to','assigned_at','ai_disclosed_at','ai_disclosure_delivered_at','owner_unsent_reply','owner_unsent_reply_at'], null, null, null),
    ('messages', 'erase', null, null, null, null),
    ('message_fragments', 'erase', null, null, null, null),
    ('turns', 'erase', null, null, null, null),
    ('drafts', 'erase', null, null, null, null),
    ('conversation_state', 'erase', null, null, null, null),
    ('conversation_signals', 'erase', null, null, null, null),
    ('conversation_events', 'erase', null, null, null, null),
    ('conversation_notes', 'erase', null, null, null, null),
    ('escalation_events', 'erase', null, null, null, null),
    ('handoffs', 'erase', null, null, null, null),
    ('sample_requests', 'erase', null, null, null, null),
    ('quotes', 'erase-unless-kept', null, null, null, null),
    ('quote_proofs', 'erase', null, null, null, null),
    ('outbound_messages', 'erase', null, null, null, null),
    ('outbound_transitions', 'erase', null, null, null, null),
    ('deliveries', 'erase', null, null, null, null),
    ('repairs', 'erase', null, null, null, null),
    ('shadow.turn_decisions', 'erase', null, null, null, null),
    ('spot_checks', 'detach', array['correction'], null, array['conversation_id'], null),
    ('orders', 'keep', array['client_email','shipping_address','notes','tracking_reference'], null, null, null),
    ('order_updates', 'keep', array['note','tracking_reference'], null, null, null),
    ('email_confirmations', 'keep', array['subject','body_html'], array['to_email'], null, null),
    ('sequence_enrollments', 'erase', null, null, null, 'identity'),
    ('sequence_sends', 'erase', null, null, null, null),
    ('contacts', 'erase', null, null, null, 'identity'),
    ('contact_consent', 'erase', null, null, null, 'identity'),
    ('pilot_allowlist', 'erase', null, null, null, 'phone'),
    ('suppressions', 'keep', array['detail'], null, null, 'identity'),
    ('opt_outs', 'keep-standing', null, null, null, 'any-identity'),
    ('deletion_requests', 'keep', array['subject_note'], null, null, null),
    ('deletion_asks', 'erase', null, null, null, null),
    ('customers_answered', 'erase', null, null, null, null),
    ('order_proposals', 'erase', null, null, null, null),
    ('promised_dates', 'erase', null, null, null, null),
    ('client_faces', 'erase', null, null, null, null),
    ('channel_events', 'receipts', null, null, null, null),
    ('channel_audit', 'redact', null, null, null, null),
    ('logins', 'unrelated', null, null, null, null),
    ('login_codes', 'unrelated', null, null, null, null),
    ('advisor_turn_subjects', 'erase', null, null, null, null),
    ('advisor_turns', 'erase', null, null, null, null),
    ('advisor_threads', 'erase', null, null, null, null)
$$;
revoke all on function customer_erasure_contract() from public;

insert into _migrations (version, name) values (140, 'kept_records')
  on conflict (version) do nothing;
