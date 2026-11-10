-- 0232 — SETUP IN MINUTES (Block 4.4 of the finishing roadmap, 2026-11-08).
--
-- Customers brought in from a file, and the first time that happened. What is new:
--   · `contact_imports` — a file of customers as the owner gave it (or pasted it), kept only while the owner checks it:
--     the cells as read, whether the first record is a header, which column is which, and which rows the owner ticked.
--     It is gone when the owner adds the customers or discards the file (`contact_import_discard`), after seven days
--     at most (`expire_contact_imports`, an hourly job), when any customer of the workspace is erased (every staged file
--     of it goes: one may hold that customer's number, and adding it afterwards would bring them back), and with the
--     workspace (it has `business_id`, so the workspace's erasure takes it). It is never a `catalog_imports` row.
--     Nothing in it is keyed to a customer: adding
--     writes `clients` and `client_channels` rows as ensureConversation would, and no consent, conversation, allowlist,
--     activation or outbound row (src/db/contactImports.ts). A practice copy keeps none.
--   · `businesses.contacts_first_imported_at` — the first time customers came in from a file (added or matched). A
--     trigger keeps the first value: a later import never moves it, and nothing sets it back to NULL.
--   · `clients.stated_language` — the language a file stated for a customer: the OWNER'S word, kept apart from
--     `preferred_language`, which is the customer's own reading (the analyser's, G11). Surveys and invoice reminders
--     prefer preferred_language to the language of the customer's own messages, and the send gate, the fast path and
--     the gate language read it too, so a file must not write there; nothing on the send path reads this column. An
--     erasure clears it with the customer's other fields (`erase_customer_rows` wrapped; the contract restated).
--   · the audit verb `customers_imported` — counts only, never a name or a number.

alter table businesses
  add column if not exists contacts_first_imported_at timestamptz;

alter table clients
  add column if not exists stated_language text
    check (stated_language is null or stated_language ~ '^[a-z]{2}$');

create or replace function contacts_first_imported_keep() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.contacts_first_imported_at is not null then
    new.contacts_first_imported_at := old.contacts_first_imported_at;
  end if;
  return new;
end $$;
drop trigger if exists businesses_contacts_first_imported_keep on businesses;
create trigger businesses_contacts_first_imported_keep
  before update of contacts_first_imported_at on businesses
  for each row execute function contacts_first_imported_keep();

create table if not exists contact_imports (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  -- file: an uploaded CSV, TSV or Excel workbook · paste: a table typed or pasted into the box
  source      text not null check (source in ('file', 'paste')),
  -- Every record as read, the header and blank lines included (so a row number is the file's own): an array of arrays
  -- of strings. 5,000 customers in a file at most (src/core/onboard/contactImport.ts); 10,001 records with the blanks.
  cells       jsonb not null check (jsonb_typeof(cells) = 'array' and jsonb_array_length(cells) between 1 and 10001),
  has_header  boolean not null default false,
  -- { name, phone, language, notes }: each a zero-based column index or null.
  mapping     jsonb not null check (jsonb_typeof(mapping) = 'object'),
  -- The record numbers (one-based, header included) the owner ticked; NULL is every row that can be added.
  selected    integer[],
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists contact_imports_business on contact_imports (business_id, created_at);
create index if not exists contact_imports_created on contact_imports (created_at);

alter table contact_imports enable row level security;
drop policy if exists contact_imports_tenant on contact_imports;
create policy contact_imports_tenant on contact_imports for all to nomi_app
  using (business_id = current_business_id()) with check (business_id = current_business_id());
-- The accountant sees none of it (0177's policy, here on the new table): it is the sales side's.
drop policy if exists not_for_accountants on contact_imports;
create policy not_for_accountants on contact_imports as restrictive for all
  using (not (select viewer_is_accountant())) with check (not (select viewer_is_accountant()));
revoke all on contact_imports from public, nomi_app;
grant select, insert, update on contact_imports to nomi_app;

-- A practice copy reaches nobody (0086): it keeps no file of customers either.
drop trigger if exists contact_imports_practice_refuses on contact_imports;
create trigger contact_imports_practice_refuses
  before insert or update on contact_imports
  for each row execute function practice_refuses();

-- ── a kept file goes ───────────────────────────────────────────────────────────────────────────────────────────────
-- One file of the workspace the transaction is for, removed (the owner added its customers, or discarded it). The app
-- role deletes nothing itself; another workspace's id removes nothing.
create or replace function contact_import_discard(p_import uuid) returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare v_n bigint;
begin
  delete from contact_imports where id = p_import and business_id = current_business_id();
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;
revoke all on function contact_import_discard(uuid) from public;
grant execute on function contact_import_discard(uuid) to nomi_app;

-- Every kept file older than seven days, in every workspace, removed: the hourly job. Returns how many. It takes no
-- time from its caller: the cut-off is the database's own now() (as expire_waiting_drafts()), so a session of the app
-- role, which may call this definer, can never reach a file younger than seven days in any workspace.
create or replace function expire_contact_imports() returns bigint
language plpgsql volatile security definer set search_path = public as $$
declare v_n bigint;
begin
  delete from contact_imports where created_at < now() - interval '7 days';
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function expire_contact_imports() from public;
grant execute on function expire_contact_imports() to nomi_app;

-- ── the audit's verbs ──────────────────────────────────────────────────────────────────────────────────────────────
-- 0229's list, copied from the live constraint, with one added: customers brought in from a file (counts only).
alter table channel_audit drop constraint if exists channel_audit_action_check;
alter table channel_audit add constraint channel_audit_action_check
  check (action in ('connect','reconnect','disconnect','test','rotate_credential',
                    'set_owner_phone','update_profile','activate','deactivate',
                    'blocked_not_allowlisted','allowlist_add','allowlist_archive',
                    'send_refused','activation_refused','product_edited',
                    'price_rules_set','transcript_corrected',
                    'assistant_added','assistant_changed','assistant_archived',
                    'export_data','deletion_requested','deletion_withdrawn',
                    'assistant_stop','assistant_start',
                    'deletion_dismissed',
                    'product_imported','import_confirmed','prices_to_owner_set','selling_set',
                    'how_you_sell_saved','knowledge_imported','pilot_ended','pilot_resumed',
                    'customer_erased',
                    'opt_out_recorded','opt_out_lifted',
                    'procedure_added','procedure_archived',
                    'customers_imported'));

-- ── the erasure knows the table ────────────────────────────────────────────────────────────────────────────────────
-- customer_erasure_contract, re-made from its latest definition (0231) with the one table, erased by WORKSPACE (a match
-- of its own, `workspace`: every row of the business). A kept file is keyed to no customer — the customers it made are
-- `clients` rows, erased as every customer is — but a file staged before a customer's erasure may still hold their
-- number, and adding it afterwards would bring them back; nothing in a file says which row was whose (the erasure
-- ledger keeps ids only), so a customer's erasure takes every staged file of the workspace. The owner uploads again.
-- tools/erase-buyer.mjs plans the same rows (`match: 'workspace'`), so its counts equal the function's.
create or replace function customer_erasure_contract()
returns table (tbl text, action text, clear text[], blank text[], detach text[], match text)
language sql immutable set search_path = public as $$
  values
    ('clients', 'anonymise', array['display_name','email','phone','country','preferred_language','notes','stated_language'], null::text[], null::text[], null::text),
    ('client_channels', 'erase', null, null, null, null),
    ('conversations', 'shell', array['assigned_to','assigned_at','ai_disclosed_at','ai_disclosure_delivered_at','owner_unsent_reply','owner_unsent_reply_at'], null, null, null),
    ('messages', 'erase', null, null, null, null),
    ('message_fragments', 'erase', null, null, null, null),
    ('turns', 'erase', null, null, null, null),
    -- 0224 — a practice photo or voice note hangs off its practice conversation: goes with it.
    ('practice_media', 'erase', null, null, null, null),
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
    -- 0215 — a business's own TikTok account and its grant: the business's, no customer in it (a customer's TikTok
    -- handle is a client_channels row, erased as every channel's is).
    ('tiktok_accounts', 'unrelated', null, null, null, null),
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
    -- 0217 — an operator alert or an account letter that reached nobody, kept until it does: never a customer's.
    ('undelivered_alerts', 'unrelated', null, null, null, null),
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
    -- 0229 — the owner's procedures: the assistant's instructions, no customer in them.
    ('procedures', 'unrelated', null, null, null, null),
    -- 0230 — the checks run before a change goes live: the staged change and case REFERENCES, never a customer's words.
    ('case_checks', 'unrelated', null, null, null, null),
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
    -- 0227 — spending: the owner's categories, bills, recurring costs and their proposals; nothing of a customer.
    ('spending_categories', 'unrelated', null, null, null, null),
    ('spending_bills', 'unrelated', null, null, null, null),
    ('recurring_costs', 'unrelated', null, null, null, null),
    ('spending_proposals', 'unrelated', null, null, null, null),
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
    ('survey_asks', 'erase', null, null, null, null),
    -- 0226 — an invoice's public link (a token and its expiry, pointing at the business's own invoice): no customer in it.
    ('invoice_links', 'unrelated', null, null, null, null),
    -- 0226 — that an invoice went to a customer, and the reminders about it: the record of the business's invoice stays
    -- (when, on which channel, how many reminders), the keys to the customer's conversation, message and draft go.
    ('invoice_sends', 'detach', null, null, array['conversation_id','outbound_id'], null),
    ('invoice_reminders', 'detach', null, null, array['conversation_id','outbound_id','draft_id'], null),
    -- 0231 — that a month's report went to the owner, and when: the workspace's own, no customer in it.
    ('month_report_sends', 'unrelated', null, null, null, null),
    -- 0232 — a file of customers kept while the owner checks it: every one of the workspace goes with any customer.
    ('contact_imports', 'erase', null, null, null, 'workspace')
$$;
revoke all on function customer_erasure_contract() from public;

-- erase_customer_rows, WRAPPED as 0226 did: whatever the function is when this migration runs keeps its work under a new
-- name; the new one runs it, then clears the language a file stated (the customer's row stays, emptied, as before), and
-- erases every staged file of customers of the workspace (counted under `erased` as `contact_imports`). A replay after a
-- restore (tools/replay-erasures.mjs) runs this same function, so it takes the files the restore brought back.
do $$
begin
  if to_regprocedure('erase_customer_rows_before_0232(uuid, uuid, uuid, boolean)') is null then
    alter function erase_customer_rows(uuid, uuid, uuid, boolean) rename to erase_customer_rows_before_0232;
  end if;
end $$;
-- erase_customer_rows, re-made from its latest definition (0226): the wrapper described above.
create or replace function erase_customer_rows(p_business uuid, p_client uuid, p_request uuid, p_restored boolean default false)
returns jsonb
language plpgsql volatile security definer set search_path = public set row_security = off as $$
declare
  v_counts jsonb;
  v_files bigint;
begin
  v_counts := erase_customer_rows_before_0232(p_business, p_client, p_request, p_restored);
  update clients set stated_language = null
   where id = p_client and business_id = p_business and stated_language is not null;
  delete from contact_imports where business_id = p_business;
  get diagnostics v_files = row_count;
  return jsonb_set(v_counts, '{erased}', erasure_add(coalesce(v_counts -> 'erased', '{}'::jsonb), 'contact_imports', v_files));
end $$;
revoke all on function erase_customer_rows(uuid, uuid, uuid, boolean) from public;
revoke all on function erase_customer_rows_before_0232(uuid, uuid, uuid, boolean) from public;

insert into _migrations (version, name) values (232, 'setup_minutes')
  on conflict (version) do nothing;
