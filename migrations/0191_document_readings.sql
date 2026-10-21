-- ---------------------------------------------------------------------------
-- 0191 — WHAT WAS READ FROM A PAPER, AND THE DRAFT MADE FROM IT (Phase 5, D6; item 7).
--
-- A receipt, invoice or bill the owner keeps (A4's documents) can be READ: the reader says what is printed on it,
-- and that reading is kept as it came — which reader, which question, what it answered, and what Nomi's check
-- found wrong with it (src/core/books/reading.ts) — never changed after. From a reading without problems, the owner
-- may draft ONE entry: the reading then names that draft (`entry_id`), set once. A reading never posts anything;
-- the draft is posted, or discarded, by the owner like any other.
-- ---------------------------------------------------------------------------

create table if not exists document_readings (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references businesses(id) on delete cascade,
  document_id    uuid not null,
  read_at        timestamptz not null default now(),
  read_by        text not null check (length(btrim(read_by)) between 1 and 120),
  model_id       text not null check (length(btrim(model_id)) between 1 and 120),
  prompt_version text not null check (length(btrim(prompt_version)) between 1 and 60),
  outcome        text not null check (outcome in ('read', 'unreadable', 'cut_off')),
  reading        jsonb,
  problems       jsonb not null default '[]'::jsonb,
  entry_id       uuid,
  drafted_at     timestamptz,
  drafted_by     text,
  unique (business_id, id),
  foreign key (business_id, document_id) references documents (business_id, id) on delete cascade,
  foreign key (business_id, entry_id) references journal_entries (business_id, id) on delete cascade,
  check ((entry_id is null) = (drafted_at is null) and (entry_id is null) = (drafted_by is null)),
  check (outcome = 'read' or (reading is null and entry_id is null))
);
create index if not exists document_readings_by_document on document_readings (business_id, document_id, read_at desc);

-- Kept as read; the one change is naming the draft made from it, once, from a reading with no problem.
create or replace function document_readings_rules() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if books_purge_allowed() then return old; end if;
    raise exception 'books: a reading is kept as it was read' using errcode = 'NB026';
  end if;
  if tg_op = 'UPDATE' then
    if books_purge_allowed() then return new; end if;
    if old.entry_id is not null or new.entry_id is null
       or (to_jsonb(new) - 'entry_id' - 'drafted_at' - 'drafted_by') <> (to_jsonb(old) - 'entry_id' - 'drafted_at' - 'drafted_by') then
      raise exception 'books: a reading is kept as it was read; it names one draft, once' using errcode = 'NB026';
    end if;
    if jsonb_array_length(old.problems) > 0 or old.outcome <> 'read' then
      raise exception 'books: nothing is drafted from a reading with problems' using errcode = 'NB026';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists document_readings_rules on document_readings;
create trigger document_readings_rules before update or delete on document_readings for each row execute function document_readings_rules();

alter table document_readings enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'document_readings' and policyname = 'document_readings_tenant') then
    create policy document_readings_tenant on document_readings for all to nomi_app
      using (business_id = current_business_id()) with check (business_id = current_business_id());
  end if;
end $$;
-- The accountant sees the readings (the books), and makes none (0186's trigger, here too).
drop trigger if exists books_owner_acts on document_readings;
create trigger books_owner_acts before insert or update or delete on document_readings for each row execute function books_owner_acts();
grant select, insert, update on document_readings to nomi_app;
revoke delete, truncate on document_readings from nomi_app;

-- A closing workspace holds its readings with its books (0189's erasure, re-made).
create or replace function erase_workspace_rows(p_business uuid, p_dry boolean, p_restored boolean default false)
returns jsonb
language plpgsql volatile security definer set search_path = public set row_security = off as $$
declare
  v_ids uuid[];
  v_id uuid;
  v_step record;
  v_n bigint;
  v_active bigint := 0;
  v_tables jsonb := '{}';
  v_copies jsonb := '{}';
  -- A2.4 — the books a closing workspace must keep (0169–0172), and until when.
  v_books text[] := array['books_settings', 'accounts', 'journals', 'fiscal_years', 'journal_counters', 'journal_entries',
                          'journal_lines', 'tax_codes', 'parties', 'custom_field_defs', 'books_exports',
                          -- A3 (0173): the owner's rates the posted lines were turned at.
                          'owner_rates',
                          -- C2 (0184): the invoices, their lines, their numbering and their payments.
                          'invoice_counters', 'invoices', 'invoice_lines', 'invoice_payments',
                          -- C3 (0185): the statements read in and the matches made against them.
                          'statement_imports', 'statement_lines', 'statement_matches',
                          -- D1b (0188): the credit notes, their lines and their numbering.
                          'credit_note_counters', 'credit_notes', 'credit_note_lines',
                          -- D2 (0189): every lock and reopening of the books' periods.
                          'period_locks',
                          -- D6 (0191): what was read from the papers, and the drafts made from it.
                          'document_readings',
                          -- A4 (0174): the papers behind the entries.
                          'documents', 'document_blobs'];
  v_hold boolean;
  v_keep date;
begin
  if not exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise exception 'erasure: the role % is subject to row-level security, so it cannot see every row it must erase', current_user
      using errcode = 'NE009';
  end if;
  if not exists (select 1 from businesses where id = p_business) then
    raise exception 'erasure: no workspace %', p_business using errcode = 'NE004';
  end if;
  v_ids := array(select id from businesses where practice_of = p_business order by id) || p_business;
  -- A2.4 — posted books are the statutory record: they stay until the legal date, with the business row they hang
  -- on; everything else of the workspace goes. And the owner leaves with them FIRST (the owner, 2026-10-21): no
  -- export covering the last posting, no closure.
  v_hold := exists (select 1 from journal_entries e where e.business_id = p_business and e.state = 'posted')
         -- A4 (0174): papers are the record too, attached yet or not.
         or exists (select 1 from documents x where x.business_id = p_business);
  -- A4 (0174): the later of the books' date and the papers' own.
  v_keep := greatest(books_keep_until(p_business), (select max(keep_until) from documents where business_id = p_business));
  -- A4 (0174): the papers too are taken first, every time. The copy of them comes with the pages that list them
  -- (A6); until a receipt for it exists, a workspace holding papers does not close.
  if not p_dry and exists (select 1 from documents x where x.business_id = p_business) then
    raise exception 'books: this workspace keeps papers (receipts, invoices, bills), and they were not downloaded — download them first; nothing was changed'
      using errcode = 'NE011';
  end if;
  if v_hold and not p_dry and not books_export_covers(p_business) then
    raise exception 'books: this workspace keeps books, and they were not downloaded since the last entry was posted — download them first; nothing was changed'
      using errcode = 'NE011';
  end if;
  if not v_hold then
    -- Nothing posted: drafts, accounts and settings are not the record, and go with the rest.
    perform set_config('nomi.books_purge', 'workspace-erasure', true);
  end if;
  if not p_dry then
    perform set_config('lock_timeout', '15s', true);
    -- Every insert that names the business waits on this, then finds it gone.
    perform 1 from businesses where id = any(v_ids) for update;
  end if;
  if to_regclass('pgboss.job') is not null and not p_restored and not p_dry then
    execute $q$select count(*) from pgboss.job where data->>'businessId' = any($1) and state::text = 'active'$q$
      into v_active using array(select x::text from unnest(v_ids) x);
    if v_active > 0 then
      raise exception 'erasure: a worker is running % job(s) for this workspace right now; nothing was changed — try again in a minute', v_active
        using errcode = 'NE002';
    end if;
  end if;
  if p_restored and to_regclass('pgboss.job') is not null and not p_dry then
    execute $q$delete from pgboss.job where data->>'businessId' = any($1) and state::text = 'active'$q$
      using array(select x::text from unnest(v_ids) x);
  end if;
  foreach v_id in array v_ids loop
    for v_step in select * from workspace_erasure_steps() loop
      if v_hold and v_id = p_business and (v_step.label = any(v_books) or v_step.label = 'businesses') then
        continue;
      end if;
      if p_dry then
        execute v_step.count_sql into v_n using v_id;
      else
        execute v_step.run_sql using v_id;
        get diagnostics v_n = row_count;
      end if;
      if v_id = p_business then
        v_tables := erasure_add(v_tables, v_step.label, coalesce((v_tables->>v_step.label)::bigint, 0) + v_n);
      else
        v_copies := erasure_add(v_copies, v_step.label, coalesce((v_copies->>v_step.label)::bigint, 0) + v_n);
      end if;
    end loop;
  end loop;
  if v_hold and not p_dry then
    update businesses set is_active = false, books_closed_at = now(), books_held_until = v_keep where id = p_business;
  end if;
  if not p_dry and exists (select 1 from businesses where id = any(v_ids) and not (v_hold and id = p_business)) then
    raise exception 'erasure: the workspace is still there after the erasure. Rolled back; nothing changed.' using errcode = 'NE010';
  end if;
  return jsonb_build_object('tables', v_tables, 'copies', v_copies,
                            'rows', erasure_total(v_tables) + erasure_total(v_copies))
      || case when v_hold then jsonb_build_object('books_held_until', v_keep) else '{}'::jsonb end;
end $$;
revoke all on function erase_workspace_rows(uuid, boolean, boolean) from public;

-- The erasure contract, re-made from its latest definition (0189) with the new table.
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
    ('document_readings', 'unrelated', null, null, null, null)
$$;
revoke all on function customer_erasure_contract() from public;

insert into _migrations (version, name) values (191, 'document_readings')
  on conflict (version) do nothing;
