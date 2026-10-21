-- ---------------------------------------------------------------------------
-- 0184 — INVOICES AND PAYMENTS (Phase 5, C2; item 5).
--
-- An invoice is drafted, then ISSUED. Issuing takes its number from its own counter — never the journals', never
-- the orders' — one per workspace and year, F-<year>-<n>, with no gap: the number is taken inside the issuing
-- transaction, so a rolled-back issue never existed. Issued, it never changes; a correction is a credit note
-- (later). Each line's net is quantity × unit price, its tax the net at its tax code's rate, both rounded to the cent,
-- and the database checks both. Issuing posts the invoice's journal entry in the same transaction: the receivable
-- debited with the total, sales and tax credited.
--
-- A PAYMENT is in the invoice's currency, partial or full, never more than what is still owed, and posts its own
-- entry: the bank debited, the receivable credited — relieved at the receivable's own value in the books' currency,
-- never re-rated — and, for a foreign invoice, the realised exchange difference as its own marked line on the
-- exchange accounts (0182). An invoice is open, partly paid or paid by its payments. Payments never change.
-- ---------------------------------------------------------------------------

create table if not exists invoice_counters (
  business_id  uuid not null references businesses(id) on delete cascade,
  year         integer not null check (year between 2000 and 2999),
  last_number  integer not null default 0 check (last_number >= 0),
  primary key (business_id, year)
);

create table if not exists invoices (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  party_id     uuid not null,
  state        text not null default 'draft' check (state in ('draft', 'issued', 'discarded')),
  year         integer,
  number       integer,
  issue_date   date not null,
  due_date     date,
  currency     text not null check (currency in ('USD', 'CNY', 'AED', 'SAR', 'BRL', 'MXN', 'INR', 'IDR', 'MAD', 'EUR', 'GBP')),
  label        text check (label is null or length(label) <= 200),
  entry_id     uuid,
  created_by   text not null,
  created_at   timestamptz not null default now(),
  issued_by    text,
  issued_at    timestamptz,
  unique (business_id, id),
  unique (business_id, year, number),
  foreign key (business_id, party_id) references parties (business_id, id) on delete cascade,
  foreign key (business_id, entry_id) references journal_entries (business_id, id) on delete cascade,
  check (due_date is null or due_date >= issue_date),
  check ((state = 'issued') = (number is not null)),
  check ((number is null) = (year is null)),
  check (state <> 'issued' or (issued_by is not null and issued_at is not null))
);

create table if not exists invoice_lines (
  business_id  uuid not null references businesses(id) on delete cascade,
  invoice_id   uuid not null,
  line_no      integer not null check (line_no > 0),
  label        text not null check (length(label) between 1 and 200),
  quantity     numeric(18,4) not null check (quantity > 0),
  unit_price   numeric(18,4) not null check (unit_price >= 0),
  account_id   uuid not null,
  tax_code_id  uuid,
  net          numeric(18,2) not null,
  tax          numeric(18,2) not null default 0,
  primary key (invoice_id, line_no),
  foreign key (business_id, invoice_id) references invoices (business_id, id) on delete cascade,
  foreign key (business_id, account_id) references accounts (business_id, id) on delete cascade,
  foreign key (business_id, tax_code_id) references tax_codes (business_id, id) on delete cascade
);

create table if not exists invoice_payments (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references businesses(id) on delete cascade,
  invoice_id      uuid not null,
  paid_on         date not null,
  currency        text not null,
  amount          numeric(18,2) not null check (amount > 0),
  -- what this payment relieved of the receivable, in the books' currency (the last one clears what is left)
  receivable_book numeric(18,2) not null,
  account_id      uuid not null,
  entry_id        uuid not null,
  created_by      text not null,
  created_at      timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, invoice_id) references invoices (business_id, id) on delete cascade,
  foreign key (business_id, account_id) references accounts (business_id, id) on delete cascade,
  foreign key (business_id, entry_id) references journal_entries (business_id, id) on delete cascade
);

-- Totals: what an invoice is owed, and what was paid of it. Both in the invoice's currency.
create or replace function invoice_total(p_invoice uuid) returns numeric
  language sql stable as $$ select coalesce(sum(net + tax), 0) from invoice_lines where invoice_id = p_invoice $$;
create or replace function invoice_paid(p_invoice uuid) returns numeric
  language sql stable as $$ select coalesce(sum(amount), 0) from invoice_payments where invoice_id = p_invoice $$;

-- A line's figures are the database's to check: net = quantity × price, tax = net × its code's rate, to the cent;
-- an issued or discarded invoice's lines never change.
create or replace function invoice_lines_rules() returns trigger
language plpgsql as $$
declare
  s text; r numeric;
begin
  select state into s from invoices where id = coalesce(new.invoice_id, old.invoice_id);
  if s <> 'draft' and not books_purge_allowed() then
    raise exception 'books: an issued invoice never changes — a correction is a credit note' using errcode = 'NB018';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.net <> round(new.quantity * new.unit_price, 2) then
    raise exception 'books: a line''s net is its quantity times its price, to the cent' using errcode = 'NB018';
  end if;
  r := coalesce((select rate from tax_codes where id = new.tax_code_id), 0);
  if new.tax <> round(new.net * r / 100, 2) then
    raise exception 'books: a line''s tax is its net at its tax code''s rate, to the cent' using errcode = 'NB018';
  end if;
  return new;
end $$;
drop trigger if exists invoice_lines_rules on invoice_lines;
create trigger invoice_lines_rules before insert or update or delete on invoice_lines for each row execute function invoice_lines_rules();

-- Issuing takes the number (security definer: the app never writes the counter); issued, nothing changes but the
-- one link to the entry the issue posted, set once, to a posted entry whose document is this invoice's number.
create or replace function invoices_rules() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n integer; ref text; e record;
begin
  if tg_op = 'DELETE' then
    if old.state = 'issued' and not books_purge_allowed() then
      raise exception 'books: an issued invoice is never deleted' using errcode = 'NB018';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.state <> 'draft' or new.number is not null then
      raise exception 'books: an invoice is drafted, then issued' using errcode = 'NB018';
    end if;
    return new;
  end if;
  if old.state = 'discarded' and not books_purge_allowed() then
    raise exception 'books: a discarded invoice stays discarded' using errcode = 'NB018';
  end if;
  if old.state = 'issued' then
    if books_purge_allowed() then return new; end if;
    if old.entry_id is null and new.entry_id is not null
       and (to_jsonb(new) - 'entry_id') = (to_jsonb(old) - 'entry_id') then
      select state, document_ref into e from journal_entries where id = new.entry_id;
      ref := 'F-' || old.year || '-' || lpad(old.number::text, 4, '0');
      if e.state = 'posted' and e.document_ref = ref then return new; end if;
    end if;
    raise exception 'books: an issued invoice never changes — a correction is a credit note' using errcode = 'NB018';
  end if;
  if new.state = 'issued' then
    if new.number is not null and new.number is distinct from old.number then
      raise exception 'books: an invoice''s number is the database''s to give, at issue' using errcode = 'NB018';
    end if;
    if (select count(*) from invoice_lines where invoice_id = new.id) = 0 then
      raise exception 'books: an invoice is issued with its lines' using errcode = 'NB018';
    end if;
    new.year := extract(year from new.issue_date)::int;
    insert into invoice_counters (business_id, year, last_number) values (new.business_id, new.year, 0)
      on conflict (business_id, year) do nothing;
    update invoice_counters set last_number = last_number + 1 where business_id = new.business_id and year = new.year
      returning last_number into n;
    new.number := n;
    new.issued_at := now();
  elsif new.number is not null then
    raise exception 'books: a draft has no number' using errcode = 'NB018';
  end if;
  return new;
end $$;
revoke all on function invoices_rules() from public;
drop trigger if exists invoices_rules on invoices;
create trigger invoices_rules before insert or update or delete on invoices for each row execute function invoices_rules();

-- A counter only rises, by one; it is never released.
create or replace function invoice_counters_rules() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if books_purge_allowed() then return old; end if;
    raise exception 'books: an invoice numbering is never released' using errcode = 'NB018';
  end if;
  if tg_op = 'UPDATE' and new.last_number <> old.last_number + 1 and not books_purge_allowed() then
    raise exception 'books: an invoice number only ever rises by one' using errcode = 'NB018';
  end if;
  return new;
end $$;
drop trigger if exists invoice_counters_rules on invoice_counters;
create trigger invoice_counters_rules before update or delete on invoice_counters for each row execute function invoice_counters_rules();

-- A payment: in the invoice's currency, of an issued invoice, never more than is still owed; posted; never changed.
create or replace function invoice_payments_rules() returns trigger
language plpgsql as $$
declare
  i record; owed numeric; e record;
begin
  if tg_op <> 'INSERT' then
    if books_purge_allowed() then return coalesce(new, old); end if;
    raise exception 'books: a payment never changes — a correction is a new entry' using errcode = 'NB019';
  end if;
  select state, currency into i from invoices where id = new.invoice_id;
  if i.state <> 'issued' then
    raise exception 'books: only an issued invoice is paid' using errcode = 'NB019';
  end if;
  if new.currency <> i.currency then
    raise exception 'books: a payment is in its invoice''s currency (%)', i.currency using errcode = 'NB019';
  end if;
  owed := invoice_total(new.invoice_id) - invoice_paid(new.invoice_id);
  if new.amount > owed then
    raise exception 'books: % is more than is still owed (%)', new.amount, owed using errcode = 'NB019';
  end if;
  select state into e from journal_entries where id = new.entry_id;
  if e.state <> 'posted' then
    raise exception 'books: a payment is recorded with its posted entry' using errcode = 'NB019';
  end if;
  return new;
end $$;
drop trigger if exists invoice_payments_rules on invoice_payments;
create trigger invoice_payments_rules before insert or update or delete on invoice_payments for each row execute function invoice_payments_rules();

-- Row security, the accountant's sight (these ARE the books: 0177's policy does not hold them), and grants.
do $$
declare t text;
begin
  foreach t in array array['invoice_counters', 'invoices', 'invoice_lines', 'invoice_payments'] loop
    execute format('alter table %I enable row level security', t);
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_tenant') then
      execute format('create policy %I on %I for all to nomi_app using (business_id = current_business_id()) with check (business_id = current_business_id())', t || '_tenant', t);
    end if;
  end loop;
end $$;
grant select on invoice_counters to nomi_app;
revoke insert, update, delete, truncate on invoice_counters from nomi_app;
grant select, insert, update on invoices, invoice_lines to nomi_app;
grant select, insert on invoice_payments to nomi_app;
revoke delete, truncate on invoices, invoice_lines from nomi_app;
revoke update, delete, truncate on invoice_payments from nomi_app;

-- A closing workspace holds its invoices and payments with its books (0174's erasure, re-made).
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

-- The erasure contract, re-made from its latest definition (0181) with the new tables.
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
    ('invoice_payments', 'unrelated', null, null, null, null)
$$;
revoke all on function customer_erasure_contract() from public;

insert into _migrations (version, name) values (184, 'invoices_payments')
  on conflict (version) do nothing;
