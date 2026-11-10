-- 0231 — "WHAT NOMI DID FOR YOU" (Block 4.3 of the finishing roadmap, 2026-11-07).
--
-- A monthly page and a monthly e-mail of what the assistant did, every figure a COUNT or a SUM over rows that already
-- exist (src/db/monthReport.ts). What is new holds no customer:
--   · `businesses.report_minutes_per_reply` — the owner's own figure for the minutes a reply would have taken them.
--     NULL means no estimate: the page and the e-mail show none until the owner types one (1–60, whole minutes).
--   · `businesses.month_report_mail_off_at` — the owner stopped the monthly e-mail on the month page. NULL: it goes
--     whenever the installation sends it (MONTH_REPORT_MAIL=on).
--   · `month_report_sends` — that a month's e-mail was claimed for the owner, once, and what came of it. The claim is
--     made by `claim_month_reports(now)` before anything is sent, so a second run, a retry or a second worker sends
--     nothing; `month_report_done` records the outcome. The app role only reads its own rows.

alter table businesses
  add column if not exists report_minutes_per_reply smallint
    check (report_minutes_per_reply between 1 and 60);
alter table businesses
  add column if not exists month_report_mail_off_at timestamptz;

create table if not exists month_report_sends (
  business_id  uuid not null references businesses(id) on delete cascade,
  month        text not null check (month ~ '^2[0-9]{3}-(0[1-9]|1[0-2])$'),
  sent_at      timestamptz not null default now(),
  outcome      text check (outcome in ('sent', 'empty', 'no_address', 'not_sent', 'failed')),
  primary key (business_id, month)
);

alter table month_report_sends enable row level security;
drop policy if exists month_report_sends_tenant on month_report_sends;
create policy month_report_sends_tenant on month_report_sends for select to nomi_app
  using (business_id = current_business_id());
-- The accountant sees none of it (0177's policy, here on the new table): it is the sales side's.
drop policy if exists not_for_accountants on month_report_sends;
create policy not_for_accountants on month_report_sends as restrictive for all
  using (not (select viewer_is_accountant())) with check (not (select viewer_is_accountant()));
revoke all on month_report_sends from public, nomi_app;
grant select on month_report_sends to nomi_app;

-- ── the month's e-mail, claimed once ───────────────────────────────────────────────────────────────────────────────
-- The e-mails due at p_now, each claimed once: for the month that just ended in the workspace's zone (an unknown zone
-- reads as UTC), from 08:00 on the 1st and within the month's first seven days (turning the e-mail on late never sends
-- a stale one), outside the owner's quiet hours (0150's rule), in a workspace that is switched on, not suspended, not
-- a practice copy, whose owner has not stopped it, and that had begun (signed_up_at, else created_at) before the
-- month ended. Whether the month had anything in it is the app's question after the claim (`month_report_done`).
create or replace function claim_month_reports(p_now timestamptz)
returns table (business_id uuid, month text, zone text)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
begin
  return query
  with zones as materialized (select name from pg_timezone_names),
  here as (
    select b.id as business_id, coalesce(z.name, 'UTC') as zone, coalesce(b.signed_up_at, b.created_at) as began,
           p.quiet_from, p.quiet_until,
           p_now at time zone coalesce(z.name, 'UTC') as local
      from businesses b
      join people p on p.business_id = b.id and p.is_owner and p.archived_at is null
      left join zones z on z.name = b.timezone
     where b.is_active and b.practice_of is null and b.month_report_mail_off_at is null
       and not exists (select 1 from workspace_suspensions s where s.business_id = b.id and s.restored_at is null)
  ), ready as (
    select h.business_id, h.zone,
           to_char(date_trunc('month', h.local) - interval '1 month', 'YYYY-MM') as month
      from here h
     where h.local >= date_trunc('month', h.local) + interval '8 hours'
       and h.local < date_trunc('month', h.local) + interval '7 days'
       and h.began < (date_trunc('month', h.local) at time zone h.zone)
       and not (h.quiet_from is not null and case
             when h.quiet_from < h.quiet_until then extract(hour from h.local) >= h.quiet_from and extract(hour from h.local) < h.quiet_until
             else extract(hour from h.local) >= h.quiet_from or extract(hour from h.local) < h.quiet_until end)
  ), ins as (
    insert into month_report_sends (business_id, month, sent_at)
    select distinct r.business_id, r.month, p_now from ready r
    on conflict (business_id, month) do nothing
    returning month_report_sends.business_id, month_report_sends.month
  )
  select i.business_id, i.month, r.zone from ins i join (select distinct business_id, zone from ready) r on r.business_id = i.business_id;
end $$;
revoke all on function claim_month_reports(timestamptz) from public;
grant execute on function claim_month_reports(timestamptz) to nomi_app;

-- What came of one claim.
create or replace function month_report_done(p_business uuid, p_month text, p_outcome text)
returns void
language sql volatile security definer set search_path = public as $$
  update month_report_sends set outcome = p_outcome where business_id = p_business and month = p_month
$$;
revoke all on function month_report_done(uuid, text, text) from public;
grant execute on function month_report_done(uuid, text, text) to nomi_app;

-- ── the erasure knows the table ────────────────────────────────────────────────────────────────────────────────────
-- customer_erasure_contract, re-made from its latest definition (0230) with the one table, `unrelated`.
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
    ('month_report_sends', 'unrelated', null, null, null, null)
$$;
revoke all on function customer_erasure_contract() from public;

insert into _migrations (version, name) values (231, 'month_report')
  on conflict (version) do nothing;
