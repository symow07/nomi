-- ---------------------------------------------------------------------------
-- 0217 — AN ALARM THAT REACHES SOMEBODY (the owner's approval, 2026-10-27).
--
-- On 2026-10-22 the scheduled backup could not upload (the bucket refused its keys) and nobody heard. The app's
-- stale-backup check fired on 10-23 and 10-24 and wrote its e-mail into a mailbox Google had revoked twelve hours
-- before; a refused alert left one warning line in the log and nothing else, and the heartbeat stayed green.
--
--   · backup_failures — the scheduled job writes one row whenever a run fails (backup/run.sh `fail`): the run's name,
--     the step it was on and why. The app reads it; only the job writes it, as with backup_runs (0069). The newest row
--     newer than the newest completed run means the last backup failed: the heartbeat pings its /fail, and the
--     operator is told once per row (`claim_backup_failures()`, the five-minute sweep).
--   · mail_accounts.attention_alerted_at — a mailbox whose grant died is told to its owner once
--     (`claim_mailbox_attention()`, the same sweep). The operator's own mailbox also fails the heartbeat while it
--     needs connecting again: an alarm about the mail must not travel by that mail alone.
--   · undelivered_alerts — an operator alert or an account letter that reached nobody: kept, one open row per
--     workspace and kind, tried again every hour for seven days, marked delivered the first time a way works.
--     While one is open the heartbeat pings its /fail. No customer is in it (the erasure contract says so).
-- ---------------------------------------------------------------------------

create table if not exists backup_failures (
  id         bigserial primary key,
  name       text not null check (name ~ '^nomi-backup-[0-9]{8}T[0-9]{6}Z$'),
  failed_at  timestamptz not null default now(),
  step       text not null check (step in ('read', 'dump', 'drill', 'encrypt', 'upload', 'prune', 'record')),
  reason     text not null check (length(reason) between 1 and 500),
  taken_by   text not null default 'railway-cron' check (length(taken_by) <= 40),
  alerted_at timestamptz
);
create index if not exists backup_failures_newest on backup_failures (failed_at desc);
comment on table backup_failures is
  'One row per failed scheduled backup (backup/run.sh). Read by the heartbeat and told to the operator once (claim_backup_failures). Only the job writes it.';
revoke insert, update, delete, truncate on backup_failures from nomi_app;
grant select on backup_failures to nomi_app;

-- The operator hears of each failed run once: claimed and answered in one statement, so two workers cannot both tell.
create or replace function claim_backup_failures()
returns table (name text, failed_at timestamptz, step text, reason text)
language sql security definer set search_path = public, pg_temp as $$
  update backup_failures f set alerted_at = now()
   where f.alerted_at is null and f.failed_at > now() - interval '2 days'
  returning f.name, f.failed_at, f.step, f.reason
$$;
revoke all on function claim_backup_failures() from public;
grant execute on function claim_backup_failures() to nomi_app;

alter table mail_accounts add column if not exists attention_alerted_at timestamptz;

-- Every workspace's mailbox whose grant died and whose owner has not been told: told once, across workspaces — so
-- security definer, and it does only this. A practice copy holds no mailbox (0086).
create or replace function claim_mailbox_attention()
returns table (business_id uuid, address text, reason text, since timestamptz)
language sql security definer set search_path = public, pg_temp as $$
  update mail_accounts m set attention_alerted_at = now()
   where m.archived_at is null and m.needs_attention_at is not null and m.attention_alerted_at is null
  returning m.business_id, m.address, m.last_error, m.needs_attention_at
$$;
revoke all on function claim_mailbox_attention() from public;
grant execute on function claim_mailbox_attention() to nomi_app;

create table if not exists undelivered_alerts (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references businesses(id) on delete cascade,
  kind            text not null check (kind ~ '^[a-z_]{1,40}$'),
  job             jsonb not null,
  why             text not null check (length(why) between 1 and 500),
  first_failed_at timestamptz not null default now(),
  last_tried_at   timestamptz not null default now(),
  tries           integer not null default 1 check (tries >= 1),
  delivered_at    timestamptz
);
create unique index if not exists undelivered_alerts_one_open on undelivered_alerts (business_id, kind) where delivered_at is null;
comment on table undelivered_alerts is
  'An operator alert or account letter that reached nobody (src/pipeline/notify.ts): tried again hourly for seven days; the heartbeat fails while one is open.';

alter table undelivered_alerts enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'undelivered_alerts' and policyname = 'undelivered_alerts_tenant') then
    create policy undelivered_alerts_tenant on undelivered_alerts
      for all to nomi_app
      using (business_id = current_business_id())
      with check (business_id = current_business_id());
  end if;
end $$;
grant select, insert, update on undelivered_alerts to nomi_app;
revoke delete, truncate on undelivered_alerts from nomi_app;

-- The accountant sees none of it (0177's policy, on the new table).
drop policy if exists not_for_accountants on undelivered_alerts;
create policy not_for_accountants on undelivered_alerts as restrictive for all
  using (not (select viewer_is_accountant())) with check (not (select viewer_is_accountant()));

-- What is still undelivered, across workspaces (the heartbeat and the hourly retry ask before any tenant is known):
-- open rows from the last seven days, and with `p_every`, only those not tried within it. Ids and kinds, nothing else.
create or replace function undelivered_alerts_open(p_every interval default null)
returns table (id uuid, business_id uuid, kind text, first_failed_at timestamptz, tries integer)
language sql stable security definer set search_path = public, pg_temp as $$
  select u.id, u.business_id, u.kind, u.first_failed_at, u.tries
    from undelivered_alerts u
   where u.delivered_at is null and u.first_failed_at > now() - interval '7 days'
     and (p_every is null or u.last_tried_at <= now() - p_every)
   order by u.first_failed_at
$$;
revoke all on function undelivered_alerts_open(interval) from public;
grant execute on function undelivered_alerts_open(interval) to nomi_app;

-- The erasure contract, re-made from its latest definition (0215) with the new table.
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
    ('survey_asks', 'erase', null, null, null, null)
$$;
revoke all on function customer_erasure_contract() from public;

insert into _migrations (version, name) values (217, 'alarms_reach_owner')
  on conflict (version) do nothing;
