-- ---------------------------------------------------------------------------
-- 0169 — THE LEDGER (Phase 5, A2.1: the books' model; docs/PHASE-5.md §3).
--
-- Nomi's books are the record (decision 10): a system of record, kept ten years. So the rules a ledger lives by are
-- the DATABASE's, not the app's — a bug, a script or a hand at a psql prompt meets the same refusals:
--
--   · an entry posts only BALANCED, per currency: in each currency its debits equal its credits;
--   · nothing is deleted by the app (G20: its role holds DELETE on nothing). A draft it no longer wants is DISCARDED:
--     a final state, never numbered, kept like everything else;
--   · a posted entry is never edited and never deleted. A correction is a REVERSING entry, linked to the one it
--     reverses (at most one each), whose lines are the original's with debit and credit swapped;
--   · each journal numbers its posted entries per fiscal year 1, 2, 3 … with NO GAP AND NO REPEAT (CNC Avis n° 24,
--     annex §2). The number is taken by the database at posting, in the posting's own transaction, from a counter
--     the app cannot touch: it only ever rises by one, it is never released, and a posting that rolls back never
--     existed. (Not the order counter's path: 0162's `order_numbers` is the app's to update and nothing stops it
--     going down — see PHASE-5.md C1.)
--   · an entry belongs to a fiscal year that is OPEN, falls inside it, and is dated after the workspace's lock date;
--     at most TWO fiscal years are open at once (Avis 24);
--   · a posted entry carries its document reference and date, the time it was posted and who posted it (Avis 24).
--
-- Every foreign key inside the books cascades: the protection is the triggers', not the keys'. A cascade that
-- reaches a posted entry, its lines, its fiscal year or its counter is refused like any other delete, unless it is
-- an operator's purge — so deleting a workspace never takes its posted books with it.
--
-- Amounts are `numeric(18,2)`: every currency this product holds has two minor units (ISO 4217; MINOR_UNITS in
-- src/core/types/money.ts). A currency with three joins with its own migration.
--
-- The only way to remove a posted entry is an OPERATOR's purge: a role other than the app's, with
-- `nomi.books_purge` set in its transaction (the test-tenant pruner; A2.4's erasure after the legal date). The app's
-- role is refused even with the setting.
-- ---------------------------------------------------------------------------

-- ── the workspace's books settings ─────────────────────────────────────────────────────────────────────────────────
create table if not exists books_settings (
  business_id  uuid primary key references businesses(id) on delete cascade,
  -- Nothing dated on or before this day may be posted, or drafted: the months the owner (or the accountant) closed.
  lock_date    date,
  updated_at   timestamptz not null default now()
);

-- ── the chart ──────────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists accounts (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  code        text not null check (code ~ '^[0-9A-Za-z][0-9A-Za-z.\-]{0,19}$'),
  name        text not null check (length(btrim(name)) between 1 and 200),
  kind        text not null check (kind in ('asset', 'liability', 'equity', 'income', 'expense', 'off_balance')),
  parent_id   uuid,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (business_id, code),
  unique (business_id, id),
  foreign key (business_id, parent_id) references accounts (business_id, id) on delete cascade
);

-- ── journals, and the fiscal years they number in ──────────────────────────────────────────────────────────────────
create table if not exists journals (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  code        text not null check (code ~ '^[A-Z0-9]{1,8}$'),
  name        text not null check (length(btrim(name)) between 1 and 120),
  -- Avis 24: the closing entries have a journal of their own.
  kind        text not null check (kind in ('sales', 'purchases', 'bank', 'cash', 'general', 'closing')),
  created_at  timestamptz not null default now(),
  unique (business_id, code),
  unique (business_id, id)
);

create table if not exists fiscal_years (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  starts_on   date not null,
  ends_on     date not null,
  state       text not null default 'open' check (state in ('open', 'closed')),
  closed_at   timestamptz,
  closed_by   text,
  created_at  timestamptz not null default now(),
  check (ends_on > starts_on and ends_on - starts_on <= 731),
  check ((state = 'open') = (closed_at is null)),
  check (state = 'open' or closed_by is not null),
  unique (business_id, starts_on),
  unique (business_id, id)
);

-- The counter: one row per journal and fiscal year. The app reads it and nothing else.
create table if not exists journal_counters (
  business_id    uuid not null,
  journal_id     uuid not null,
  fiscal_year_id uuid not null,
  last_number    integer not null check (last_number >= 1),
  primary key (journal_id, fiscal_year_id),
  foreign key (business_id, journal_id) references journals (business_id, id) on delete cascade,
  foreign key (business_id, fiscal_year_id) references fiscal_years (business_id, id) on delete cascade
);

-- ── entries and lines ──────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists journal_entries (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references businesses(id) on delete cascade,
  journal_id     uuid not null,
  fiscal_year_id uuid not null,
  number         integer check (number >= 1),
  entry_date     date not null,
  label          text not null check (length(btrim(label)) between 1 and 300),
  document_ref   text check (document_ref is null or length(btrim(document_ref)) between 1 and 120),
  document_date  date,
  state          text not null default 'draft' check (state in ('draft', 'posted', 'discarded')),
  created_at     timestamptz not null default now(),
  created_by     text not null check (length(btrim(created_by)) >= 1),
  posted_at      timestamptz,
  posted_by      text,
  -- A correction: the posted entry this one reverses. At most one reversal each.
  reverses_id    uuid unique,
  check ((state in ('draft', 'discarded') and number is null and posted_at is null and posted_by is null)
      or (state = 'posted' and number is not null and posted_at is not null and posted_by is not null
          and document_ref is not null and document_date is not null)),
  unique (journal_id, fiscal_year_id, number),
  unique (business_id, id),
  foreign key (business_id, journal_id) references journals (business_id, id) on delete cascade,
  foreign key (business_id, fiscal_year_id) references fiscal_years (business_id, id) on delete cascade,
  foreign key (business_id, reverses_id) references journal_entries (business_id, id) on delete cascade
);
create index if not exists journal_entries_by_date on journal_entries (business_id, entry_date);

create table if not exists journal_lines (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  entry_id    uuid not null,
  line_no     integer not null check (line_no >= 1),
  account_id  uuid not null,
  label       text check (label is null or length(label) <= 300),
  currency    text not null check (currency in ('USD', 'CNY', 'AED', 'SAR', 'BRL', 'MXN', 'INR', 'IDR', 'MAD', 'EUR', 'GBP')),
  debit       numeric(18,2) not null default 0 check (debit >= 0),
  credit      numeric(18,2) not null default 0 check (credit >= 0),
  -- One side each: a line is a debit or a credit, never both, never neither.
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0)),
  unique (entry_id, line_no),
  foreign key (business_id, entry_id) references journal_entries (business_id, id) on delete cascade,
  foreign key (business_id, account_id) references accounts (business_id, id) on delete cascade
);
create index if not exists journal_lines_by_account on journal_lines (business_id, account_id);

-- ── the rules ──────────────────────────────────────────────────────────────────────────────────────────────────────

-- An operator's purge, never the app's: connected as a role other than nomi_app, with the setting on in its
-- transaction. `session_user`, not `current_user`: inside a SECURITY DEFINER trigger current_user is the owner, and
-- the app could otherwise set the setting and purge through it.
create or replace function books_purge_allowed() returns boolean
language sql stable as $$
  select session_user <> 'nomi_app' and current_user <> 'nomi_app'
     and coalesce(current_setting('nomi.books_purge', true), '') <> ''
$$;

-- At most two fiscal years open; a closed one never reopens; two never overlap.
create or replace function fiscal_years_rules() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    -- An empty year (nothing ever posted in it) may go with its workspace; one with the record in it may not.
    if books_purge_allowed() or not exists (select 1 from journal_entries e where e.fiscal_year_id = old.id and e.state = 'posted') then
      return old;
    end if;
    raise exception 'books: fiscal year % holds posted entries and is never deleted', old.starts_on using errcode = 'NB001';
  end if;
  if tg_op = 'UPDATE' then
    if old.state = 'closed' then
      if books_purge_allowed() then return new; end if;
      raise exception 'books: fiscal year % is closed and stays closed', old.starts_on using errcode = 'NB001';
    end if;
    if new.starts_on <> old.starts_on or new.ends_on <> old.ends_on or new.business_id <> old.business_id then
      raise exception 'books: a fiscal year keeps its dates' using errcode = 'NB001';
    end if;
    if new.state = 'closed' and exists (select 1 from journal_entries e where e.fiscal_year_id = old.id and e.state = 'draft') then
      raise exception 'books: fiscal year % still has drafts — post or discard them before it closes', old.starts_on
        using errcode = 'NB003';
    end if;
  end if;
  if exists (select 1 from fiscal_years f where f.business_id = new.business_id and f.id <> new.id
               and daterange(f.starts_on, f.ends_on, '[]') && daterange(new.starts_on, new.ends_on, '[]')) then
    raise exception 'books: fiscal year % to % overlaps another', new.starts_on, new.ends_on using errcode = 'NB002';
  end if;
  if new.state = 'open' and (select count(*) from fiscal_years f
                               where f.business_id = new.business_id and f.state = 'open' and f.id <> new.id) >= 2 then
    raise exception 'books: two fiscal years are open already (Avis 24 allows two at most)' using errcode = 'NB003';
  end if;
  return new;
end $$;
drop trigger if exists fiscal_years_rules on fiscal_years;
create trigger fiscal_years_rules before insert or update or delete on fiscal_years
  for each row execute function fiscal_years_rules();

-- The counter rises by one, from one, and is never lowered, released or removed.
create or replace function journal_counters_rules() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if books_purge_allowed() then return old; end if;
    raise exception 'books: a journal''s numbering is never released' using errcode = 'NB004';
  end if;
  if tg_op = 'INSERT' and new.last_number <> 1 then
    raise exception 'books: a journal''s numbering starts at 1' using errcode = 'NB004';
  end if;
  if tg_op = 'UPDATE' and (new.last_number <> old.last_number + 1 or new.journal_id <> old.journal_id
                           or new.fiscal_year_id <> old.fiscal_year_id or new.business_id <> old.business_id) then
    raise exception 'books: a journal''s number only ever rises by one (% to %)', old.last_number, new.last_number
      using errcode = 'NB004';
  end if;
  return new;
end $$;
drop trigger if exists journal_counters_rules on journal_counters;
create trigger journal_counters_rules before insert or update or delete on journal_counters
  for each row execute function journal_counters_rules();

-- Is this day one the workspace may still write in?
create or replace function books_day_writable(p_business uuid, p_fiscal_year uuid, p_day date) returns text
language sql stable as $$
  select case
    when f.id is null then 'no such fiscal year'
    when f.state <> 'open' then format('fiscal year %s to %s is closed', f.starts_on, f.ends_on)
    when p_day < f.starts_on or p_day > f.ends_on then format('%s is outside fiscal year %s to %s', p_day, f.starts_on, f.ends_on)
    when s.lock_date is not null and p_day <= s.lock_date then format('%s is on or before the lock date %s', p_day, s.lock_date)
    else null end
  from (select 1) one
  left join fiscal_years f on f.id = p_fiscal_year and f.business_id = p_business
  left join books_settings s on s.business_id = p_business
$$;

-- In each currency, the entry's debits equal its credits; and it has two lines at least.
create or replace function journal_entry_unbalanced(p_entry uuid) returns text
language sql stable as $$
  select case
    when (select count(*) from journal_lines where entry_id = p_entry) < 2 then 'an entry needs two lines at least'
    else (select string_agg(format('%s: debits %s, credits %s', currency, d, c), '; ' order by currency)
            from (select currency, sum(debit) as d, sum(credit) as c from journal_lines
                   where entry_id = p_entry group by currency) t
           where d <> c)
  end
$$;

-- A reversal's lines are the original's, debit and credit swapped, account for account, currency for currency.
create or replace function journal_reversal_mismatch(p_entry uuid, p_original uuid) returns boolean
language sql stable as $$
  with a as (select account_id, currency, sum(debit) as d, sum(credit) as c from journal_lines where entry_id = p_entry group by 1, 2),
       b as (select account_id, currency, sum(credit) as d, sum(debit) as c from journal_lines where entry_id = p_original group by 1, 2)
  select exists (select 1 from (select * from a except select * from b) x)
      or exists (select 1 from (select * from b except select * from a) y)
$$;

-- The entry: drafted in a writable day; posted balanced, numbered by the database; posted, never changed again.
-- SECURITY DEFINER for one reason: it raises the counter, which the app's role may not write. It acts only on the
-- row being changed, which row security already let the caller reach.
create or replace function journal_entries_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  why text;
  n integer;
  orig record;
begin
  if tg_op = 'DELETE' then
    if old.state = 'posted' and not books_purge_allowed() then
      raise exception 'books: entry % of journal % is posted, and a posted entry is never deleted — reverse it', old.number, old.journal_id
        using errcode = 'NB005';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.state = 'posted' then
    if books_purge_allowed() then return new; end if;
    raise exception 'books: entry % is posted, and a posted entry is never changed — reverse it', old.number
      using errcode = 'NB005';
  end if;
  if tg_op = 'UPDATE' and old.state = 'discarded' then
    if books_purge_allowed() then return new; end if;
    raise exception 'books: a discarded draft stays discarded — draft a new entry' using errcode = 'NB005';
  end if;
  -- Discarding a draft changes nothing else about it, and needs no writable day: it is not the record.
  if tg_op = 'UPDATE' and new.state = 'discarded' then
    if (new.journal_id, new.fiscal_year_id, new.entry_date, new.label, new.document_ref, new.document_date, new.reverses_id)
       is distinct from (old.journal_id, old.fiscal_year_id, old.entry_date, old.label, old.document_ref, old.document_date, old.reverses_id)
       or new.number is not null then
      raise exception 'books: a draft is discarded as it is' using errcode = 'NB007';
    end if;
    return new;
  end if;

  -- Drafted or posted, the day must be one the workspace may write in.
  why := books_day_writable(new.business_id, new.fiscal_year_id, new.entry_date);
  if why is not null then
    raise exception 'books: %', why using errcode = 'NB006';
  end if;

  if new.state = 'draft' then
    if new.number is not null or new.posted_at is not null or new.posted_by is not null then
      raise exception 'books: a draft has no number and is not posted' using errcode = 'NB007';
    end if;
    return new;
  end if;

  -- From here: posting (an insert straight to posted is refused: an entry is posted from a draft with its lines).
  if tg_op = 'INSERT' then
    raise exception 'books: an entry is drafted with its lines, then posted' using errcode = 'NB007';
  end if;
  if new.number is not null and old.number is null then
    raise exception 'books: the number is the database''s to give, at posting' using errcode = 'NB007';
  end if;
  if new.document_ref is null or new.document_date is null then
    raise exception 'books: an entry is posted with its document''s reference and date' using errcode = 'NB008';
  end if;
  if new.posted_by is null or length(btrim(new.posted_by)) = 0 then
    raise exception 'books: an entry is posted by someone' using errcode = 'NB008';
  end if;
  why := journal_entry_unbalanced(new.id);
  if why is not null then
    raise exception 'books: the entry does not balance — %', why using errcode = 'NB009';
  end if;
  if new.reverses_id is not null then
    select * into orig from journal_entries where id = new.reverses_id;
    if orig.state is distinct from 'posted' then
      raise exception 'books: only a posted entry can be reversed' using errcode = 'NB010';
    end if;
    if journal_reversal_mismatch(new.id, new.reverses_id) then
      raise exception 'books: a reversal''s lines are the original''s, debit and credit swapped' using errcode = 'NB010';
    end if;
  end if;

  insert into journal_counters as k (business_id, journal_id, fiscal_year_id, last_number)
  values (new.business_id, new.journal_id, new.fiscal_year_id, 1)
  on conflict (journal_id, fiscal_year_id) do update set last_number = k.last_number + 1
  returning k.last_number into n;
  new.number := n;
  new.posted_at := now();
  return new;
end $$;
revoke all on function journal_entries_rules() from public;
drop trigger if exists journal_entries_rules on journal_entries;
create trigger journal_entries_rules before insert or update or delete on journal_entries
  for each row execute function journal_entries_rules();

-- A line is written, changed or removed only while its entry is a draft.
create or replace function journal_lines_rules() returns trigger
language plpgsql as $$
declare s text;
begin
  select state into s from journal_entries where id = coalesce(new.entry_id, old.entry_id);
  if s = 'posted' and not books_purge_allowed() then
    raise exception 'books: the entry is posted, and its lines are never changed — reverse it' using errcode = 'NB005';
  end if;
  if s = 'discarded' and not books_purge_allowed() then
    raise exception 'books: the draft was discarded, and its lines stay as they were' using errcode = 'NB005';
  end if;
  if tg_op = 'UPDATE' and new.entry_id <> old.entry_id then
    raise exception 'books: a line stays on its entry' using errcode = 'NB005';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists journal_lines_rules on journal_lines;
create trigger journal_lines_rules before insert or update or delete on journal_lines
  for each row execute function journal_lines_rules();

-- ── row security and grants ────────────────────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['books_settings', 'accounts', 'journals', 'fiscal_years', 'journal_counters', 'journal_entries', 'journal_lines'] loop
    execute format('alter table %I enable row level security', t);
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_tenant') then
      execute format('create policy %I on %I for all to nomi_app using (business_id = current_business_id()) with check (business_id = current_business_id())', t || '_tenant', t);
    end if;
  end loop;
end $$;

grant select, insert, update on books_settings, accounts, journals, fiscal_years to nomi_app;
grant select on journal_counters to nomi_app;
-- The default privileges (0005) give the app insert and update on every new table: not this one. A counter the app
-- could raise by one without posting would be a gap; only the posting trigger (as the owner) writes it.
revoke insert, update on journal_counters from nomi_app;
grant select, insert, update on journal_entries, journal_lines to nomi_app;
revoke delete, truncate on books_settings, accounts, journals, fiscal_years, journal_counters from nomi_app;
revoke delete, truncate on journal_entries, journal_lines from nomi_app;
revoke all on function books_purge_allowed() from public;
grant execute on function books_purge_allowed() to nomi_app;

-- ── the erasure contract, re-made with the books' tables (0144: every table with a business's rows is decided) ────
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
    ('journal_lines', 'unrelated', null, null, null, null)
$$;
revoke all on function customer_erasure_contract() from public;

insert into _migrations (version, name) values (169, 'ledger')
  on conflict (version) do nothing;
