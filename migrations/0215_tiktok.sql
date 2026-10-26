-- ---------------------------------------------------------------------------
-- 0215 — TIKTOK DIRECT MESSAGES (PHASE-5.md decision 8; docs/TIKTOK-CHANNEL.md, surface A only — the owner, 2026-10-26).
--
-- A business connects its OWN TikTok account (a Business account with Advanced Access, or verified) through TikTok's
-- Business Messaging API, and the assistant answers the people who write to it, under the same send gate, erasure,
-- roles and row security as every other channel. Built against a recorded fake of TikTok's documented answers;
-- nothing has met TikTok (the access steps are the owner's).
--
--   · 'tiktok' joins the six channel lists: a conversation, a customer's handle, a channel's source, a queued message,
--     a credential and a channel row. The lists are copied from their latest definitions (0203; channels.kind, 0011).
--   · tiktok_accounts — the account a business connected (like meta_accounts, 0054): its TikTok `open_id`, its name,
--     and ONE sealed grant — the access token (a day), the refresh token (a year) and when each ends, together, with
--     CREDENTIAL_KEY (tools/rekey.mjs knows the column). One live account per business, one live business per account.
--     A token TikTok refused is marked (`last_error`), and the page asks to connect again. TikTok sends no message
--     content for a customer in the EEA, Switzerland or the UK (`im_receive_msg_eu`): such a message is only counted
--     here, so the page can say people there wrote and must be answered in TikTok.
--   · A practice copy holds no TikTok account (0086's refusal, on the new table).
--   · No customer's data is in tiktok_accounts: a customer's TikTok handle is a client_channels row, erased with them.
-- ---------------------------------------------------------------------------

alter table conversations   drop constraint if exists conversations_channel_check;
alter table conversations   add  constraint conversations_channel_check
  check (channel in ('whatsapp','wechat','instagram','messenger','rednote','webhook_test','email','web_chat','telegram','tiktok'));

alter table client_channels drop constraint if exists client_channels_channel_check;
alter table client_channels add  constraint client_channels_channel_check
  check (channel in ('whatsapp','wechat','instagram','messenger','rednote','webhook_test','email','web_chat','telegram','tiktok'));

alter table channel_sources drop constraint if exists channel_sources_channel_check;
alter table channel_sources add  constraint channel_sources_channel_check
  check (channel in ('whatsapp','wechat','instagram','messenger','rednote','webhook_test','email','web_chat','telegram','tiktok'));

alter table outbound_messages drop constraint if exists outbound_messages_channel_check;
alter table outbound_messages add  constraint outbound_messages_channel_check
  check (channel in ('whatsapp','email','instagram','messenger','web_chat','telegram','tiktok'));

alter table channel_credentials drop constraint if exists channel_credentials_channel_check;
alter table channel_credentials add  constraint channel_credentials_channel_check
  check (channel in ('whatsapp','wechat','instagram','messenger','rednote','telegram',
                     'webhook_test','email','web_widget','web_chat','tiktok'));

alter table channels drop constraint if exists channels_kind_check;
alter table channels add  constraint channels_kind_check
  check (kind in ('whatsapp','instagram','messenger','wechat','rednote','telegram','line','email','web_chat','tiktok'));

create table if not exists tiktok_accounts (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references businesses(id) on delete cascade,
  open_id            text not null check (open_id ~ '^[A-Za-z0-9._-]{8,128}$'),
  username           text not null default '' check (length(username) <= 64),
  token_ciphertext   text not null check (token_ciphertext like 'v1.%'),
  key_version        integer not null default 1,
  fingerprint        text not null check (fingerprint ~ '^[0-9a-f]{12}$'),
  scopes             text not null,
  connected_by       text not null,
  connected_at       timestamptz not null default now(),
  needs_attention_at timestamptz,
  last_error         text check (last_error is null or last_error in ('revoked', 'refused')),
  eu_messages        integer not null default 0 check (eu_messages >= 0),
  eu_last_at         timestamptz,
  archived_at        timestamptz,
  archived_by        text,
  constraint tiktok_accounts_archive_whole check ((archived_at is null) = (archived_by is null)),
  constraint tiktok_accounts_attention_whole check ((needs_attention_at is null) = (last_error is null))
);
create unique index if not exists tiktok_accounts_one_live on tiktok_accounts (business_id) where archived_at is null;
create unique index if not exists tiktok_accounts_account_live on tiktok_accounts (open_id) where archived_at is null;

alter table tiktok_accounts enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'tiktok_accounts' and policyname = 'tiktok_accounts_tenant') then
    create policy tiktok_accounts_tenant on tiktok_accounts
      for all to nomi_app
      using (business_id = current_business_id())
      with check (business_id = current_business_id());
  end if;
end $$;
grant select, insert, update on tiktok_accounts to nomi_app;
revoke delete, truncate on tiktok_accounts from nomi_app;

-- A practice copy can reach nobody (0086): its refusal, on the new table.
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'tiktok_accounts_practice_refuses') then
    create trigger tiktok_accounts_practice_refuses before insert or update on tiktok_accounts
      for each row execute function practice_refuses();
  end if;
end $$;

-- What a delivery says about the ACCOUNT, before any tenant is known — so security definer, and it does only this,
-- on the live account the delivery was for: its username (TikTok names the account in each message), and a message
-- from a customer in the EEA, Switzerland or the UK (`im_receive_msg_eu`), which carries no content and no customer
-- and so is only counted.
create or replace function tiktok_note_delivery(p_open_id text, p_username text, p_eu boolean) returns void
language sql security definer set search_path = public, pg_temp as $$
  update tiktok_accounts
     set username = case when p_username is not null and p_username ~ '^[A-Za-z0-9._]{1,64}$' then p_username else username end,
         eu_messages = eu_messages + case when p_eu then 1 else 0 end,
         eu_last_at = case when p_eu then now() else eu_last_at end
   where open_id = p_open_id and archived_at is null
$$;
revoke all on function tiktok_note_delivery(text, text, boolean) from public;
grant execute on function tiktok_note_delivery(text, text, boolean) to nomi_app;

-- Owner and staff may see it (connecting is the owner's: messaging_activation); the accountant sees none (0177's
-- policy, here on the new table).
drop policy if exists not_for_accountants on tiktok_accounts;
create policy not_for_accountants on tiktok_accounts as restrictive for all
  using (not (select viewer_is_accountant())) with check (not (select viewer_is_accountant()));

-- The erasure contract, re-made from its latest definition (0202) with the new table.
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

insert into _migrations (version, name) values (215, 'tiktok')
  on conflict (version) do nothing;
