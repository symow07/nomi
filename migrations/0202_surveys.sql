-- ---------------------------------------------------------------------------
-- 0202 — HOW DID WE DO? ASKED ONLY WHERE IT IS FREE (Phase 5, S6; item 20).
--
-- After the owner confirms a buyer's order, the buyer may be asked one question — how it went, from 1 to 5 — and
-- their answer is kept. Off unless the owner switches it on (`businesses.surveys_on`). It is asked only where asking
-- costs nothing: on a chat channel inside the buyer's own 24 hours (never as a paid template), and only in a language
-- whose sentence a native reader has signed (src/core/conversation/survey.ts). Ten minutes after the order, so the
-- confirmation goes first; the minute's sweep sends it, or records why it did not.
--
--   · survey_asks — one per conversation: due → sent | skipped (with why) → answered (a score of 1 to 5, the words);
--     what was asked and when never changes, and an answer is given once.
--
-- The buyer's, and erased with them: the erasure contract, its links and erase_customer_rows know the table.
-- Owner and staff see it (sales work); the accountant sees none (0177's policy, here on the new table).
-- ---------------------------------------------------------------------------

alter table businesses add column if not exists surveys_on boolean not null default false;

create table if not exists survey_asks (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references businesses(id),
  client_id         uuid not null references clients(id),
  conversation_id   uuid not null references conversations(id),
  due_at            timestamptz not null,
  state             text not null default 'due' check (state in ('due', 'sent', 'skipped', 'answered')),
  skipped_why       text check (skipped_why in ('off', 'held', 'channel', 'not_free', 'unsigned', 'no_name')),
  language          text,
  outbound_id       uuid,
  asked_at          timestamptz,
  score             smallint check (score between 1 and 5),
  answer_text       text check (length(answer_text) <= 500),
  answer_message_id text check (length(answer_message_id) <= 200),
  answered_at       timestamptz,
  created_at        timestamptz not null default now(),
  constraint survey_asks_once unique (conversation_id),
  constraint survey_asks_skipped_says_why check ((state = 'skipped') = (skipped_why is not null)),
  constraint survey_asks_sent_has_row check (state in ('due', 'skipped') or (outbound_id is not null and asked_at is not null)),
  constraint survey_asks_answer_whole check ((state = 'answered') = (score is not null and answered_at is not null))
);
create index if not exists survey_asks_due on survey_asks (due_at) where state = 'due';
create index if not exists survey_asks_client on survey_asks (client_id, asked_at) where state = 'sent';

-- What was asked never moves; it goes forward only (due → sent | skipped; sent → answered), and an answer is given once.
create or replace function survey_asks_rules() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
begin
  if new.business_id <> old.business_id or new.client_id <> old.client_id or new.conversation_id <> old.conversation_id
     or new.due_at <> old.due_at or new.created_at <> old.created_at then
    raise exception 'surveys: what was asked of whom never changes' using errcode = 'NS001';
  end if;
  if not (old.state = new.state or (old.state = 'due' and new.state in ('sent', 'skipped')) or (old.state = 'sent' and new.state = 'answered')) then
    raise exception 'surveys: % cannot become %', old.state, new.state using errcode = 'NS002';
  end if;
  if old.state in ('sent', 'answered') and (new.outbound_id is distinct from old.outbound_id or new.asked_at is distinct from old.asked_at
     or new.language is distinct from old.language) then
    raise exception 'surveys: what was sent never changes' using errcode = 'NS001';
  end if;
  if old.state = 'answered' and (new.score is distinct from old.score or new.answer_text is distinct from old.answer_text
     or new.answered_at is distinct from old.answered_at or new.answer_message_id is distinct from old.answer_message_id) then
    raise exception 'surveys: an answer is given once' using errcode = 'NS003';
  end if;
  return new;
end $$;
drop trigger if exists survey_asks_rules on survey_asks;
create trigger survey_asks_rules before update on survey_asks for each row execute function survey_asks_rules();

alter table survey_asks enable row level security;
drop policy if exists survey_asks_tenant on survey_asks;
create policy survey_asks_tenant on survey_asks for all to nomi_app
  using (business_id = current_business_id()) with check (business_id = current_business_id());
drop policy if exists not_for_accountants on survey_asks;
create policy not_for_accountants on survey_asks as restrictive for all
  using (not (select viewer_is_accountant())) with check (not (select viewer_is_accountant()));
grant select, insert, update on survey_asks to nomi_app;
revoke delete, truncate on survey_asks from nomi_app;

-- The minute's sweep asks which workspaces have a survey due: across workspaces, so security definer, ids only.
create or replace function survey_businesses_due() returns setof uuid
  language sql stable security definer set search_path = public, pg_temp as $$
  select distinct business_id from survey_asks where state = 'due' and due_at <= now()
$$;
revoke all on function survey_businesses_due() from public;
grant execute on function survey_businesses_due() to nomi_app;

-- The erasure contract, re-made from its latest definition (0199) with the new table.
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
    ('morning_summaries', 'unrelated', null, null, null, null),
    -- 0162 — the workspace's count of its own orders: numbers, never a customer's.
    ('order_numbers', 'unrelated', null, null, null, null),
    -- 0163 — a capability withdrawn in one language: the assistant's record, no customer in it.
    ('language_withdrawals', 'unrelated', null, null, null, null),
    -- 0169 (Phase 5, A2.1) — the workspace's own books: its settings, chart, journals, fiscal years and numbering,
    -- and its entries and lines. No customer is linked to them yet; the parties (A2.2) arrive with the "kept until the
    -- legal date, then erased" action (A2.4, docs/PHASE-5.md §6), and these are re-decided with them.
    ('books_settings', 'unrelated', null, null, null, null),
    ('accounts', 'unrelated', null, null, null, null),
    ('journals', 'unrelated', null, null, null, null),
    ('fiscal_years', 'unrelated', null, null, null, null),
    ('journal_counters', 'unrelated', null, null, null, null),
    ('journal_entries', 'unrelated', null, null, null, null),
    ('journal_lines', 'unrelated', null, null, null, null),
    -- 0170 (A2.2) — tax codes and custom-field definitions: the workspace's own settings. Parties: its customers and
    -- suppliers, with no link to a buyer and no contact detail yet; re-decided with that link in A2.4.
    ('tax_codes', 'unrelated', null, null, null, null),
    ('parties', 'unrelated', null, null, null, null),
    ('custom_field_defs', 'unrelated', null, null, null, null),
    -- 0172 (A2.4) — the receipts of the owner's book downloads: what was downloaded, when, by whom; no customer.
    ('books_exports', 'unrelated', null, null, null, null),
    -- 0174 (A4) — the papers behind the books (receipts, invoices, bills) and their sealed bytes: the workspace's
    -- record, linked to its entries; no customer link (A2.4's note on parties holds for them too).
    ('documents', 'unrelated', null, null, null, null),
    ('document_blobs', 'unrelated', null, null, null, null),
    -- 0178 (Phase 5, B2) — what each connected system last said of each books record: a key and a digest, the
    -- workspace's own plumbing; no customer in it.
    ('connector_records', 'unrelated', null, null, null, null),
    -- 0179 (B3–B5) — which of the shop's systems the books are connected to, and how the last read went: the
    -- workspace's own settings, no customer in them (the grant itself is in connector_credentials, sealed).
    ('books_connections', 'unrelated', null, null, null, null),
    -- 0181 (C0) — the start dates the owner confirmed for taxes a system gave none: the workspace's own facts.
    ('tax_start_dates', 'unrelated', null, null, null, null),
    -- 0184 (C2) — invoices and their payments: the workspace's statutory record, made out to a PARTY of the books
    -- (no link to a buyer yet — a party is the books' own record); held at closure with the books.
    ('invoice_counters', 'unrelated', null, null, null, null),
    ('invoices', 'unrelated', null, null, null, null),
    ('invoice_lines', 'unrelated', null, null, null, null),
    ('invoice_payments', 'unrelated', null, null, null, null),
    -- 0185 (C3) — bank statements read in, their lines, and the matches a person made: the workspace's books.
    ('statement_imports', 'unrelated', null, null, null, null),
    ('statement_lines', 'unrelated', null, null, null, null),
    ('statement_matches', 'unrelated', null, null, null, null),
    -- 0188 (D1b) — credit notes against issued invoices, their lines and their counter: the workspace's books.
    ('credit_note_counters', 'unrelated', null, null, null, null),
    ('credit_notes', 'unrelated', null, null, null, null),
    ('credit_note_lines', 'unrelated', null, null, null, null),
    -- 0189 (D2) — every lock and reopening of the books' periods, who and why: the workspace's books.
    ('period_locks', 'unrelated', null, null, null, null),
    -- 0191 (D6) — what a reader read from a receipt, invoice or bill of the books, and the draft made from it.
    ('document_readings', 'unrelated', null, null, null, null),
    -- 0195 (S1) — the workspace's saved replies: words its people wrote to reuse, never a customer's.
    ('saved_replies', 'unrelated', null, null, null, null),
    -- 0196 (S2) — the workspace's labels: its own words; a label on a buyer is the buyer's, and goes with them.
    ('labels', 'unrelated', null, null, null, null),
    ('buyer_labels', 'erase', null, null, null, null),
    -- 0199 (S5) — the owner's decisions on answers people gave: a digest of the question's words, never the words.
    ('answer_decisions', 'unrelated', null, null, null, null),
    -- 0202 (S6) — what a buyer was asked after an order, and what they answered: theirs, and goes with them.
    ('survey_asks', 'erase', null, null, null, null)
$$;
revoke all on function customer_erasure_contract() from public;

-- The links the erasure follows, re-made from their latest definition (0197) with the new ones.
create or replace function customer_erasure_edges()
returns table (child text, col text, parent text, pcol text)
language sql immutable set search_path = public as $$
  values
    ('client_channels', 'client_id', 'clients', 'id'),
    ('client_faces', 'client_id', 'clients', 'id'),
    -- 0196 (S2) — a label on a buyer: theirs.
    ('buyer_labels', 'client_id', 'clients', 'id'),
    -- 0202 (S6) — a survey asked of a buyer, about one of their conversations: theirs.
    ('survey_asks', 'client_id', 'clients', 'id'),
    ('survey_asks', 'conversation_id', 'conversations', 'id'),
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

-- erase_customer_rows, re-made from its latest definition (0197): 0151's runs first, unchanged, as _proforma; then the
-- labels on the buyer (0197) and, new here, the surveys they were asked (0202).
create or replace function erase_customer_rows(p_business uuid, p_client uuid, p_request uuid, p_restored boolean default false)
returns jsonb
language plpgsql volatile security definer set search_path = public set row_security = off as $$
declare
  v_counts jsonb;
  v_n bigint;
  v_surveys bigint;
begin
  -- The surveys first: each names one of the conversations the erasure below takes away.
  delete from survey_asks where client_id = p_client and business_id = p_business;
  get diagnostics v_surveys = row_count;
  v_counts := erase_customer_rows_proforma(p_business, p_client, p_request, p_restored);
  delete from buyer_labels where client_id = p_client and business_id = p_business;
  get diagnostics v_n = row_count;
  if exists (select 1 from buyer_labels where client_id = p_client) then
    raise exception 'erasure: a label is still on the erased customer. Rolled back; nothing changed.' using errcode = 'NE010';
  end if;
  if exists (select 1 from survey_asks where client_id = p_client) then
    raise exception 'erasure: a survey of the erased customer is still kept. Rolled back; nothing changed.' using errcode = 'NE010';
  end if;
  -- counted with the rest of what was erased (the ledger and the closed request's note read `erased`)
  v_counts := jsonb_set(v_counts, '{erased}', erasure_add(coalesce(v_counts -> 'erased', '{}'::jsonb), 'buyer_labels', v_n));
  return jsonb_set(v_counts, '{erased}', erasure_add(coalesce(v_counts -> 'erased', '{}'::jsonb), 'survey_asks', v_surveys));
end $$;
revoke all on function erase_customer_rows(uuid, uuid, uuid, boolean) from public;

insert into _migrations (version, name) values (202, 'surveys')
  on conflict (version) do nothing;
