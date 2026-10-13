-- ---------------------------------------------------------------------------
-- 0151 — Phase 2c (the owner's roadmap, 2026-10-13): A PROFORMA THE CUSTOMER
-- CAN OPEN.
--
-- An order's proforma was text on the order page, for the owner to copy or
-- save (M46, V1-188). From here the owner can make it a link, from the
-- conversation or the order: one unguessable token on the order, opened at
-- /pi/<token> with no sign-in, in the customer's language. Making it sends
-- nothing; turning it off clears the token, and the page answers as one that
-- never existed (404), like the price link (M35, 0028).
--
-- A column, not a table: one live link per order, and nothing to keep once it
-- is off. The order is kept when its customer is erased (0126), with their
-- e-mail, address and notes cleared — and now the link with them, so no kept
-- order stays reachable from outside.
-- ---------------------------------------------------------------------------

alter table orders add column if not exists proforma_token text
  check (proforma_token is null or length(proforma_token) >= 32);
create unique index if not exists orders_proforma_token on orders (proforma_token) where proforma_token is not null;

-- Public: no session, so no tenant yet. The token to its order, and nothing of
-- the order itself — the page reads that under row security, as the price
-- link does (resolve_quote_proof).
create or replace function resolve_proforma(p_token text)
returns table (business_id uuid, order_id uuid)
language sql stable security definer set search_path = public as $$
  select o.business_id, o.id from orders o
   where o.proforma_token = p_token and p_token is not null and length(p_token) >= 32
   limit 1
$$;
revoke all on function resolve_proforma(text) from public;
grant execute on function resolve_proforma(text) to nomi_app;

-- The customer's erasure clears the link from their kept orders (0145's erasure
-- runs first, unchanged).
do $$ begin
  if not exists (select 1 from pg_proc where proname = 'erase_customer_rows_titles') then
    alter function erase_customer_rows(uuid, uuid, uuid, boolean) rename to erase_customer_rows_titles;
  end if;
end $$;
revoke all on function erase_customer_rows_titles(uuid, uuid, uuid, boolean) from public;

create or replace function erase_customer_rows(p_business uuid, p_client uuid, p_request uuid, p_restored boolean default false)
returns jsonb
language plpgsql volatile security definer set search_path = public set row_security = off as $$
declare
  v_orders uuid[];
  v_counts jsonb;
begin
  -- Their orders, before their conversations go.
  v_orders := array(select o.id from orders o where o.business_id = p_business
                      and (o.client_id = p_client or o.conversation_id in (
                            select id from conversations where client_id = p_client and business_id = p_business)));
  v_counts := erase_customer_rows_titles(p_business, p_client, p_request, p_restored);
  update orders set proforma_token = null where id = any(v_orders) and proforma_token is not null;
  if exists (select 1 from orders where id = any(v_orders) and proforma_token is not null) then
    raise exception 'erasure: a kept order still opens from outside after the erasure. Rolled back; nothing changed.' using errcode = 'NE010';
  end if;
  return v_counts;
end $$;
revoke all on function erase_customer_rows(uuid, uuid, uuid, boolean) from public;

-- 0150's contract: the proforma's link is cleared from a kept order, with its e-mail and notes.
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
    ('orders', 'keep', array['client_email','shipping_address','notes','tracking_reference','proforma_token'], null, null, null),
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
    ('advisor_threads', 'erase', null, null, null, null),
    -- D19 (0144) — the workspace's own settings and rules.
    ('autonomy_policy', 'unrelated', null, null, null, null),
    ('bundle_rules', 'unrelated', null, null, null, null),
    ('claims_policy', 'unrelated', null, null, null, null),
    ('factory_closures', 'unrelated', null, null, null, null),
    ('forbidden_terms', 'unrelated', null, null, null, null),
    ('negotiation_rules', 'unrelated', null, null, null, null),
    ('onboarding_state', 'unrelated', null, null, null, null),
    ('outreach_settings', 'unrelated', null, null, null, null),
    ('owner_rates', 'unrelated', null, null, null, null),
    ('pricing_policy', 'unrelated', null, null, null, null),
    ('sample_policy', 'unrelated', null, null, null, null),
    ('selling_answers', 'unrelated', null, null, null, null),
    ('substitution_rules', 'unrelated', null, null, null, null),
    ('trade_terms', 'unrelated', null, null, null, null),
    ('tenant_budgets', 'unrelated', null, null, null, null),
    ('assistants', 'unrelated', null, null, null, null),
    -- D19 (0144) — its catalogue and what the owner taught.
    ('products', 'unrelated', null, null, null, null),
    ('product_knowledge', 'unrelated', null, null, null, null),
    ('catalog_imports', 'unrelated', null, null, null, null),
    ('catalog_import_photos', 'unrelated', null, null, null, null),
    ('knowledge_proposals', 'unrelated', null, null, null, null),
    -- D19 (0144) — its channels and connections.
    ('channels', 'unrelated', null, null, null, null),
    ('channel_credentials', 'unrelated', null, null, null, null),
    ('channel_sources', 'unrelated', null, null, null, null),
    ('connector_credentials', 'unrelated', null, null, null, null),
    ('connection_approvals', 'unrelated', null, null, null, null),
    ('mail_accounts', 'unrelated', null, null, null, null),
    ('meta_accounts', 'unrelated', null, null, null, null),
    ('whatsapp_accounts', 'unrelated', null, null, null, null),
    ('whatsapp_templates', 'unrelated', null, null, null, null),
    ('sending_domains', 'unrelated', null, null, null, null),
    -- D19 (0144) — the people who work there, and their own records.
    ('people', 'unrelated', null, null, null, null),
    ('agents', 'unrelated', null, null, null, null),
    ('login_setups', 'unrelated', null, null, null, null),
    ('push_subscriptions', 'unrelated', null, null, null, null),
    ('advisor_consents', 'unrelated', null, null, null, null),
    -- D19 (0144) — outreach sequences as written, before anyone is enrolled.
    ('sequences', 'unrelated', null, null, null, null),
    ('sequence_steps', 'unrelated', null, null, null, null),
    -- D19 (0144) — billing, usage and plan.
    ('payments', 'unrelated', null, null, null, null),
    ('stripe_events', 'unrelated', null, null, null, null),
    ('subscriptions', 'unrelated', null, null, null, null),
    ('workspace_billing', 'unrelated', null, null, null, null),
    ('workspace_suspensions', 'unrelated', null, null, null, null),
    ('usage_ledger', 'unrelated', null, null, null, null),
    ('allowance_alerts', 'unrelated', null, null, null, null),
    ('retention_notices', 'unrelated', null, null, null, null),
    -- D19 (0144) — operations: flags, practice counts, the assistant's capability history (counts), the erasure ledger (ids and counts).
    ('ops_flags', 'unrelated', null, null, null, null),
    ('practice_checks', 'unrelated', null, null, null, null),
    ('practice_totals', 'unrelated', null, null, null, null),
    ('capability_events', 'unrelated', null, null, null, null),
    ('erasure_ledger', 'unrelated', null, null, null, null),
    -- D19 (0144) — words the owner or the operator wrote, never linked to a customer: a calendar entry, the pilot's log.
    ('calendar_entries', 'unrelated', null, null, null, null),
    ('pilot_log', 'unrelated', null, null, null, null),
    -- D19 (0144) — a company's public facts, looked up by its domain.
    ('organization_enrichments', 'unrelated', null, null, null, null),
    -- D19 (0144) — errors, with no value they carried (D19: messages stored without quoted values).
    ('app_errors', 'unrelated', null, null, null, null),
    -- D4 (0147) — the record that a waiting deletion request was chased: ids and dates, Nomi's own.
    ('deletion_chases', 'unrelated', null, null, null, null),
    -- Phase 1 (0148) — how the workspace signed up, as the abuse score decided it: the workspace's own, never a
    -- customer's. (`signup_marks` holds no business at all.)
    ('signup_risk', 'unrelated', null, null, null, null),
    -- Phase 2a (0150) — the morning summary's claims: a day and what came of it, the owner's own, never a customer's.
    ('morning_summaries', 'unrelated', null, null, null, null)
$$;

revoke all on function customer_erasure_contract() from public;

insert into _migrations (version, name) values (151, 'proforma_links')
  on conflict (version) do nothing;
