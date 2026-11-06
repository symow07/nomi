-- ---------------------------------------------------------------------------
-- 0226 — INVOICES THAT GO OUT (Block 2, PR 2 of the finishing roadmap; the owner's corrections of 2026-11-06).
--
-- An issued invoice is SENT to the customer from the conversation or from the invoice's page: as a PDF where the
-- channel carries files (WhatsApp, Messenger, Telegram, e-mail), as the order's proforma link where it does not
-- (Instagram, web chat). The PDF is rendered on demand from the invoice's rows, behind an unguessable link that
-- expires (`invoice_links`); nothing of the document is stored. Each send is recorded (`invoice_sends`), and an
-- invoice still open three and ten days after it went is reminded once each (`invoice_reminders`), on the channel it
-- went on, in English, inside the channel's window and only where a mailbox can carry it — else as a DRAFT for the
-- owner. No Meta template is submitted (the owner, 2026-11-06).
--
-- The switch is the workspace's: `books_settings.invoice_sending`, off until the owner turns it on. While it is on,
-- the order-confirmed reply says the invoice comes next — true again, because the owner can now send one.
--
-- Erasure: the two record tables reach a customer through a conversation, a queued message and a draft. They are
-- DETACHED (the business's invoice record stays; its keys to the customer go), and the keys are `on delete set null`
-- so the erasure of the message or draft never fails on them. The contract and its links are re-made from their
-- latest definitions (0217, 0202) with the three tables; `erase_customer_rows` is wrapped, whatever it is when this
-- runs. 0224 (block1_records) also re-makes the contract: the order the two merge in decides which copy is the base,
-- and the second to land must carry the first one's rows — see the note in its header.
-- ---------------------------------------------------------------------------

alter table books_settings add column if not exists invoice_sending boolean not null default false;
comment on column books_settings.invoice_sending is
  '0226: the owner lets invoices and their reminders go to customers from Nomi; off, nothing is sent and the order-confirmed reply promises none.';

-- A queued message may now be a DOCUMENT (0024 left `kind` unconstrained on purpose): `media_url` is where the file is,
-- the body its caption; the worker sends it only from Nomi's own address (F1) and only through an adapter that carries
-- files, else refuses it like a picture it cannot carry.
comment on column outbound_messages.media_url is
  '0024/0226: for kind=''image'', where the picture is (product_images.url); for kind=''document'', the file Nomi serves (invoice_links). NULL for text.';

-- ── the link a channel fetches the PDF from ────────────────────────────────────────────────────────────────────────
create table if not exists invoice_links (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  invoice_id   uuid not null,
  token        text not null unique check (length(token) >= 32),
  made_by      text not null,
  made_at      timestamptz not null default now(),
  expires_at   timestamptz not null,
  foreign key (business_id, invoice_id) references invoices (business_id, id) on delete cascade,
  check (expires_at > made_at)
);
create index if not exists invoice_links_invoice on invoice_links (invoice_id);

alter table invoice_links enable row level security;
drop policy if exists invoice_links_tenant on invoice_links;
create policy invoice_links_tenant on invoice_links for all to nomi_app
  using (business_id = current_business_id()) with check (business_id = current_business_id());
drop policy if exists not_for_accountants on invoice_links;
create policy not_for_accountants on invoice_links as restrictive for all
  using (not (select viewer_is_accountant())) with check (not (select viewer_is_accountant()));
grant select, insert, update on invoice_links to nomi_app;
revoke delete, truncate on invoice_links from nomi_app;

-- The public page resolves a token before any tenant is known — so security definer, answering only the workspace
-- and the invoice, and only while the link lives. Unknown, expired, erased: no row, alike.
create or replace function resolve_invoice_link(p_token text) returns table (business_id uuid, invoice_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select l.business_id, l.invoice_id from invoice_links l
   where l.token = p_token and l.expires_at > now()
$$;
revoke all on function resolve_invoice_link(text) from public;
grant execute on function resolve_invoice_link(text) to nomi_app;

-- ── the record that an invoice went ────────────────────────────────────────────────────────────────────────────────
create table if not exists invoice_sends (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references businesses(id) on delete cascade,
  invoice_id       uuid not null,
  conversation_id  uuid references conversations(id) on delete set null,
  outbound_id      uuid references outbound_messages(id) on delete set null,
  channel          text not null,
  carried          text not null check (carried in ('pdf', 'link')),
  sent_by          text not null,
  sent_at          timestamptz not null default now(),
  foreign key (business_id, invoice_id) references invoices (business_id, id) on delete cascade
);
create index if not exists invoice_sends_invoice on invoice_sends (invoice_id, sent_at desc);

alter table invoice_sends enable row level security;
drop policy if exists invoice_sends_tenant on invoice_sends;
create policy invoice_sends_tenant on invoice_sends for all to nomi_app
  using (business_id = current_business_id()) with check (business_id = current_business_id());
drop policy if exists not_for_accountants on invoice_sends;
create policy not_for_accountants on invoice_sends as restrictive for all
  using (not (select viewer_is_accountant())) with check (not (select viewer_is_accountant()));
grant select, insert, update on invoice_sends to nomi_app;
revoke delete, truncate on invoice_sends from nomi_app;

-- ── the reminders, once each ───────────────────────────────────────────────────────────────────────────────────────
create table if not exists invoice_reminders (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references businesses(id) on delete cascade,
  invoice_id       uuid not null,
  nth              integer not null check (nth in (1, 2)),
  conversation_id  uuid references conversations(id) on delete set null,
  outbound_id      uuid references outbound_messages(id) on delete set null,
  draft_id         uuid references drafts(id) on delete set null,
  sent_at          timestamptz,
  drafted_at       timestamptz,
  created_at       timestamptz not null default now(),
  unique (invoice_id, nth),
  foreign key (business_id, invoice_id) references invoices (business_id, id) on delete cascade,
  -- sent alone, or drafted for the owner: one of the two, never both, never neither
  check ((sent_at is null) <> (drafted_at is null))
);

alter table invoice_reminders enable row level security;
drop policy if exists invoice_reminders_tenant on invoice_reminders;
create policy invoice_reminders_tenant on invoice_reminders for all to nomi_app
  using (business_id = current_business_id()) with check (business_id = current_business_id());
drop policy if exists not_for_accountants on invoice_reminders;
create policy not_for_accountants on invoice_reminders as restrictive for all
  using (not (select viewer_is_accountant())) with check (not (select viewer_is_accountant()));
grant select, insert, update on invoice_reminders to nomi_app;
revoke delete, truncate on invoice_reminders from nomi_app;

-- The hourly sweep asks, before any tenant is known, WHICH workspaces have a reminder due: an issued invoice still
-- owed, sent from Nomi three or ten days ago, its reminder not yet sent or drafted, in a workspace whose switch is on.
-- Security definer, ids only.
create or replace function invoice_reminder_workspaces() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select distinct s.business_id
    from invoice_sends s
    join invoices i on i.id = s.invoice_id
    join books_settings bs on bs.business_id = s.business_id
   where bs.invoice_sending
     and i.state = 'issued'
     and invoice_total(i.id) - invoice_credited(i.id) - invoice_paid(i.id) > 0
     and s.sent_at = (select max(x.sent_at) from invoice_sends x where x.invoice_id = s.invoice_id)
     and ((s.sent_at <= now() - interval '3 days' and s.sent_at > now() - interval '10 days'
             and not exists (select 1 from invoice_reminders r where r.invoice_id = i.id and r.nth = 1))
       or (s.sent_at <= now() - interval '10 days'
             and not exists (select 1 from invoice_reminders r where r.invoice_id = i.id and r.nth = 2)))
$$;
revoke all on function invoice_reminder_workspaces() from public;
grant execute on function invoice_reminder_workspaces() to nomi_app;

-- A reminder drafted because the channel's window was shut is NOT expired by the ten-minute sweep: the shut window
-- is why the draft exists, and the owner decides what becomes of it — sent when the customer writes again, reached
-- another way, or skipped. Every other waiting reply is marked expired as before.
-- expire_waiting_drafts, re-made from its latest definition (0098), with the one exception.
create or replace function expire_waiting_drafts() returns integer
language sql security definer set search_path = public as $$
  with gone as (
    update drafts d set status = 'expired', decided_at = now()
      from conversations c
      join client_channels cc on cc.client_id = c.client_id and cc.channel = c.channel
     where d.conversation_id = c.id
       and d.status = 'pending'
       and c.channel in ('whatsapp', 'instagram', 'messenger')
       and cc.last_inbound_at < now() - interval '24 hours'
       and not exists (select 1 from invoice_reminders r where r.draft_id = d.id)
    returning d.id
  )
  select count(*)::integer from gone
$$;
revoke all on function expire_waiting_drafts() from public;
grant execute on function expire_waiting_drafts() to nomi_app;

-- ── the erasure knows the three tables ─────────────────────────────────────────────────────────────────────────────
-- customer_erasure_contract, re-made from its latest definition (0224, after 0217) with the three tables. 0224 (block1_records)
-- re-makes it too: whichever lands second carries the other's rows.
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
    ('survey_asks', 'erase', null, null, null, null),
    -- 0226 — an invoice's public link (a token and its expiry, pointing at the business's own invoice): no customer in it.
    ('invoice_links', 'unrelated', null, null, null, null),
    -- 0226 — that an invoice went to a customer, and the reminders about it: the record of the business's invoice stays
    -- (when, on which channel, how many reminders), the keys to the customer's conversation, message and draft go.
    ('invoice_sends', 'detach', null, null, array['conversation_id','outbound_id'], null),
    ('invoice_reminders', 'detach', null, null, array['conversation_id','outbound_id','draft_id'], null)
$$;
revoke all on function customer_erasure_contract() from public;

-- customer_erasure_edges, re-made from its latest definition (0224, after 0202) with the five new links and 0224's four.
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
    -- 0224 — a practice photo or voice note hangs off its practice conversation.
    ('practice_media', 'conversation_id', 'conversations', 'id'),
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
    -- 0224 — the quote a reply carried, on the draft, the outbound row and the sent message.
    ('drafts', 'quote_id', 'quotes', 'id'),
    ('messages', 'quote_id', 'quotes', 'id'),
    ('outbound_messages', 'quote_id', 'quotes', 'id'),
    ('outbound_transitions', 'outbound_id', 'outbound_messages', 'id'),
    ('promised_dates', 'outbound_id', 'outbound_messages', 'id'),
    ('sequence_sends', 'outbound_id', 'outbound_messages', 'id'),
    ('sequence_sends', 'enrollment_id', 'sequence_enrollments', 'id'),
    -- 0130 — the advisor's link to each customer a turn named.
    ('advisor_turn_subjects', 'client_id', 'clients', 'id'),
    -- 0226 — an invoice sent in a conversation, and its reminders.
    ('invoice_sends', 'conversation_id', 'conversations', 'id'),
    ('invoice_sends', 'outbound_id', 'outbound_messages', 'id'),
    ('invoice_reminders', 'conversation_id', 'conversations', 'id'),
    ('invoice_reminders', 'outbound_id', 'outbound_messages', 'id'),
    ('invoice_reminders', 'draft_id', 'drafts', 'id')
$$;
revoke all on function customer_erasure_edges() from public;

-- erase_customer_rows, re-made from its latest definition (0202) by WRAPPING it: whatever the function is when this
-- migration runs (0202's, or 0224's if that landed first) keeps its work under a new name; the new one first takes the
-- customer's keys off the invoice records, then runs it.
do $$
begin
  if to_regprocedure('erase_customer_rows_before_0226(uuid, uuid, uuid, boolean)') is null then
    alter function erase_customer_rows(uuid, uuid, uuid, boolean) rename to erase_customer_rows_before_0226;
  end if;
end $$;
-- erase_customer_rows, re-made from its latest definition (0202): the wrapper described above.
create or replace function erase_customer_rows(p_business uuid, p_client uuid, p_request uuid, p_restored boolean default false)
returns jsonb
language plpgsql volatile security definer set search_path = public set row_security = off as $$
declare
  v_counts jsonb;
  v_sends bigint;
  v_reminders bigint;
begin
  update invoice_sends set conversation_id = null, outbound_id = null
   where business_id = p_business
     and (conversation_id in (select c.id from conversations c where c.client_id = p_client and c.business_id = p_business)
          or outbound_id in (select o.id from outbound_messages o join conversations c on c.id = o.conversation_id
                              where c.client_id = p_client and c.business_id = p_business));
  get diagnostics v_sends = row_count;
  update invoice_reminders set conversation_id = null, outbound_id = null, draft_id = null
   where business_id = p_business
     and (conversation_id in (select c.id from conversations c where c.client_id = p_client and c.business_id = p_business)
          or outbound_id in (select o.id from outbound_messages o join conversations c on c.id = o.conversation_id
                              where c.client_id = p_client and c.business_id = p_business)
          or draft_id in (select d.id from drafts d join conversations c on c.id = d.conversation_id
                           where c.client_id = p_client and c.business_id = p_business));
  get diagnostics v_reminders = row_count;
  v_counts := erase_customer_rows_before_0226(p_business, p_client, p_request, p_restored);
  v_counts := jsonb_set(v_counts, '{changed}', erasure_add(coalesce(v_counts -> 'changed', '{}'::jsonb), 'invoice_sends', v_sends));
  return jsonb_set(v_counts, '{changed}', erasure_add(coalesce(v_counts -> 'changed', '{}'::jsonb), 'invoice_reminders', v_reminders));
end $$;
revoke all on function erase_customer_rows(uuid, uuid, uuid, boolean) from public;
revoke all on function erase_customer_rows_before_0226(uuid, uuid, uuid, boolean) from public;

insert into _migrations (version, name) values (226, 'invoices_out')
  on conflict (version) do nothing;
