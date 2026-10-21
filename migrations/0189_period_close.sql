-- ---------------------------------------------------------------------------
-- 0189 — CLOSING THE BOOKS: a checklist, a lock, a closing entry in its own journal (Phase 5, D2; item 6; Avis 24).
--
-- Until now the lock date (0169, `books_settings.lock_date`) was a column the app could set to any day, forward or
-- back, and nothing remembered it; and nothing in the app could open a fiscal year. Now:
--
--   LOCK     only forward, only up to today, only by the owner, and only when the PRE-CLOSE CHECKLIST is clear for
--            that day — no draft entry, draft invoice or draft credit note dated on or before it, and every bank
--            statement line on or before it matched (`books_close_checklist`, the database's own count). Nothing
--            dated on or before the lock is posted or drafted (0169's `books_day_writable`), with that reason.
--   REOPEN   moving the lock back is the owner's alone, with a reason, and recorded — like every lock — in
--            `period_locks`: who, when, from which day to which, and why.
--   CLOSE    a fiscal year is closed by `books_close_year`: the year locked to its last day (checklist clear), then
--            ONE closing entry, in a journal of kind 'closing' and nowhere else, dated the year's last day — each
--            income and expense account brought to nothing against the result account the owner chooses (equity) —
--            then the year marked closed. A closed year never reopens and nothing is written in it again (0169).
--            The closing journal takes no other entry: only this function writes in it.
--   YEARS    at most two fiscal years open (0169, Avis 24) — the owner opens them; the database refuses a third.
--
-- The lock date is moved only through these functions (a trigger refuses any other change), and each refuses a
-- viewer who is not the owner — staff or an accountant — so a route that forgets its guard still changes nothing.
-- ---------------------------------------------------------------------------

create table if not exists period_locks (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  action      text not null check (action in ('lock', 'reopen', 'close')),
  from_date   date,
  to_date     date,
  reason      text check (reason is null or length(btrim(reason)) between 3 and 300),
  by_person   text not null,
  at          timestamptz not null default now(),
  check (action <> 'reopen' or reason is not null)
);
create index if not exists period_locks_by_business on period_locks (business_id, at desc);
alter table period_locks enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'period_locks' and policyname = 'period_locks_tenant') then
    create policy period_locks_tenant on period_locks for all to nomi_app
      using (business_id = current_business_id()) with check (business_id = current_business_id());
  end if;
end $$;
grant select on period_locks to nomi_app;
revoke insert, update, delete, truncate on period_locks from nomi_app;

-- A viewer who is a person and not the owner (staff, an accountant). No viewer — the access-code owner, the worker,
-- the tools — is not refused here.
create or replace function viewer_is_not_owner() returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from people where id = nullif(current_setting('app.viewer_id', true), '')::uuid and not is_owner)
$$;
revoke all on function viewer_is_not_owner() from public;
grant execute on function viewer_is_not_owner() to nomi_app;

-- The lock date moves only through books_lock_to / books_reopen_to / books_close_year: statements those functions
-- run are not the app's role (they are security definer), and the app's own statements are. A setting would not do —
-- the app's role may set any setting it likes.
-- (its own function: 0173's books_settings_rules keeps the books' currency, and stays as it is)
create or replace function books_lock_rules() returns trigger
language plpgsql as $$
begin
  if current_user <> 'nomi_app' then return new; end if;
  if (tg_op = 'INSERT' and new.lock_date is not null) or (tg_op = 'UPDATE' and new.lock_date is distinct from old.lock_date) then
    raise exception 'books: the lock date moves only by locking (forward, the checklist clear) or reopening (the owner''s, with a reason)'
      using errcode = 'NB023';
  end if;
  return new;
end $$;
drop trigger if exists books_lock_rules on books_settings;
create trigger books_lock_rules before insert or update on books_settings for each row execute function books_lock_rules();

-- What must be clear before the books are locked to a day: counted by the database, each item by name.
create or replace function books_close_checklist(p_business uuid, p_day date)
returns table (item text, n integer) language sql stable security definer set search_path = public, pg_temp as $$
  select 'draft_entries', count(*)::int from journal_entries where business_id = p_business and state = 'draft' and entry_date <= p_day
  union all
  select 'draft_invoices', count(*)::int from invoices where business_id = p_business and state = 'draft' and issue_date <= p_day
  union all
  select 'draft_credit_notes', count(*)::int from credit_notes where business_id = p_business and state = 'draft' and issue_date <= p_day
  union all
  select 'unmatched_statement_lines', count(*)::int from statement_lines s where s.business_id = p_business and s.booked_on <= p_day
     and not exists (select 1 from statement_matches m where m.statement_line_id = s.id and m.unmatched_at is null)
$$;
revoke all on function books_close_checklist(uuid, date) from public;
grant execute on function books_close_checklist(uuid, date) to nomi_app;

create or replace function books_lock_to(p_day date, p_by text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b uuid := current_business_id(); cur date; first record;
begin
  if b is null then raise exception 'books: no workspace' using errcode = 'NB023'; end if;
  if viewer_is_not_owner() then raise exception 'books: locking the books is the owner''s' using errcode = 'NB024'; end if;
  if p_day is null or p_day > current_date then
    raise exception 'books: the books lock up to a day that has passed, today at the latest' using errcode = 'NB023';
  end if;
  select lock_date into cur from books_settings where business_id = b;
  if cur is not null and p_day <= cur then
    raise exception 'books: the books are locked to % already — a lock moves only forward; to move it back, reopen', cur using errcode = 'NB023';
  end if;
  select item, n into first from books_close_checklist(b, p_day) where n > 0 limit 1;
  if first.item is not null then
    raise exception 'books: the checklist is not clear for % — %: %', p_day, first.item, first.n using errcode = 'NB023';
  end if;
  insert into books_settings (business_id, lock_date) values (b, p_day)
    on conflict (business_id) do update set lock_date = excluded.lock_date, updated_at = now();
  insert into period_locks (business_id, action, from_date, to_date, by_person) values (b, 'lock', cur, p_day, p_by);
end $$;
revoke all on function books_lock_to(date, text) from public;
grant execute on function books_lock_to(date, text) to nomi_app;

-- Moving the lock BACK (or lifting it, null): the owner's, with a reason; a closed year stays closed whatever it is.
create or replace function books_reopen_to(p_day date, p_by text, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b uuid := current_business_id(); cur date;
begin
  if b is null then raise exception 'books: no workspace' using errcode = 'NB023'; end if;
  if viewer_is_not_owner() then raise exception 'books: reopening the books is the owner''s' using errcode = 'NB024'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'books: a reopening says why' using errcode = 'NB023';
  end if;
  select lock_date into cur from books_settings where business_id = b;
  if cur is null or (p_day is not null and p_day >= cur) then
    raise exception 'books: reopening moves the lock back, before %', coalesce(cur::text, 'a lock') using errcode = 'NB023';
  end if;
  update books_settings set lock_date = p_day, updated_at = now() where business_id = b;
  insert into period_locks (business_id, action, from_date, to_date, reason, by_person) values (b, 'reopen', cur, p_day, btrim(p_reason), p_by);
end $$;
revoke all on function books_reopen_to(date, text, text) from public;
grant execute on function books_reopen_to(date, text, text) to nomi_app;

-- The closing journal takes the closing entry and nothing else.
create or replace function closing_journal_rules() returns trigger
language plpgsql as $$
begin
  if (current_user <> 'nomi_app' and coalesce(current_setting('nomi.closing', true), '') = 'on') or books_purge_allowed() then return new; end if;
  if (select kind from journals where id = new.journal_id) = 'closing' then
    raise exception 'books: the closing journal takes only the closing entry, written when a year is closed' using errcode = 'NB025';
  end if;
  return new;
end $$;
drop trigger if exists aa_closing_journal_rules on journal_entries;
create trigger aa_closing_journal_rules before insert or update on journal_entries for each row execute function closing_journal_rules();

-- books_day_writable, re-made from 0169: the closing entry is dated the year's last day, which its own close locks
-- first — so while a year is being closed (and only then: inside books_close_year, never the app's own statement)
-- the lock does not stand in its way; its closed state does.
create or replace function books_day_writable(p_business uuid, p_fiscal_year uuid, p_day date) returns text
language sql stable as $$
  select case
    when f.id is null then 'no such fiscal year'
    when f.state <> 'open' then format('fiscal year %s to %s is closed', f.starts_on, f.ends_on)
    when p_day < f.starts_on or p_day > f.ends_on then format('%s is outside fiscal year %s to %s', p_day, f.starts_on, f.ends_on)
    when s.lock_date is not null and p_day <= s.lock_date
         and not (current_user <> 'nomi_app' and coalesce(current_setting('nomi.closing', true), '') = 'on')
      then format('%s is on or before the lock date %s', p_day, s.lock_date)
    else null end
  from (select 1) one
  left join fiscal_years f on f.id = p_fiscal_year and f.business_id = p_business
  left join books_settings s on s.business_id = p_business
$$;

-- Closing a year: locked to its last day (the checklist clear), its result carried to the owner's result account by
-- ONE entry in the closing journal, then closed. Returns the closing entry (null if the year had no result to carry).
create or replace function books_close_year(p_year uuid, p_result_account uuid, p_journal uuid, p_by text, p_label text, p_ref text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b uuid := current_business_id(); y record; cur date; first record; book text; e uuid; line integer := 0; total numeric := 0; r record;
begin
  if b is null then raise exception 'books: no workspace' using errcode = 'NB023'; end if;
  if viewer_is_not_owner() then raise exception 'books: closing a year is the owner''s' using errcode = 'NB024'; end if;
  select * into y from fiscal_years where id = p_year and business_id = b for update;
  if y.id is null or y.state <> 'open' then raise exception 'books: that fiscal year is not open' using errcode = 'NB023'; end if;
  if y.ends_on > current_date then raise exception 'books: a year is closed once it has ended (%)', y.ends_on using errcode = 'NB023'; end if;
  if (select kind from journals where id = p_journal and business_id = b) is distinct from 'closing' then
    raise exception 'books: a closing entry goes to a journal of kind closing' using errcode = 'NB025';
  end if;
  if (select kind from accounts where id = p_result_account and business_id = b) is distinct from 'equity' then
    raise exception 'books: the result goes to an equity account' using errcode = 'NB025';
  end if;
  select item, n into first from books_close_checklist(b, y.ends_on) where n > 0 limit 1;
  if first.item is not null then
    raise exception 'books: the checklist is not clear for % — %: %', y.ends_on, first.item, first.n using errcode = 'NB023';
  end if;
  select lock_date into cur from books_settings where business_id = b;
  if cur is null or cur < y.ends_on then
    insert into books_settings (business_id, lock_date) values (b, y.ends_on)
      on conflict (business_id) do update set lock_date = excluded.lock_date, updated_at = now();
    insert into period_locks (business_id, action, from_date, to_date, by_person) values (b, 'lock', cur, y.ends_on, p_by);
  end if;
  book := books_currency(b);
  perform set_config('nomi.closing', 'on', true);
  for r in select l.account_id, sum(l.book_debit - l.book_credit) as net
             from journal_lines l join journal_entries je on je.id = l.entry_id join accounts a on a.id = l.account_id
            where je.business_id = b and je.fiscal_year_id = y.id and je.state = 'posted' and a.kind in ('income', 'expense')
            group by l.account_id having sum(l.book_debit - l.book_credit) <> 0 order by min(a.code) loop
    if e is null then
      insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by)
        values (b, p_journal, y.id, y.ends_on, left(p_label, 200), p_by) returning id into e;
    end if;
    line := line + 1;
    insert into journal_lines (business_id, entry_id, line_no, account_id, currency, debit, credit)
      values (b, e, line, r.account_id, book, greatest(-r.net, 0), greatest(r.net, 0));
    total := total + r.net;
  end loop;
  if e is not null then
    insert into journal_lines (business_id, entry_id, line_no, account_id, currency, debit, credit)
      values (b, e, line + 1, p_result_account, book, greatest(total, 0), greatest(-total, 0));
    update journal_entries set state = 'posted', posted_by = p_by, document_ref = left(p_ref, 100), document_date = y.ends_on where id = e;
  end if;
  perform set_config('nomi.closing', '', true);
  update fiscal_years set state = 'closed', closed_at = now(), closed_by = p_by where id = y.id;
  insert into period_locks (business_id, action, from_date, to_date, by_person) values (b, 'close', y.starts_on, y.ends_on, p_by);
  return e;
end $$;
revoke all on function books_close_year(uuid, uuid, uuid, text, text, text) from public;
grant execute on function books_close_year(uuid, uuid, uuid, text, text, text) to nomi_app;

-- A year is closed by closing it — its closing entry first — never by the app setting its state.
create or replace function fiscal_years_close_rules() returns trigger
language plpgsql as $$
begin
  if new.state = 'closed' and old.state = 'open' and current_user = 'nomi_app' then
    raise exception 'books: a year is closed by closing it, its closing entry first' using errcode = 'NB025';
  end if;
  return new;
end $$;
drop trigger if exists aa_fiscal_years_close_rules on fiscal_years;
create trigger aa_fiscal_years_close_rules before update on fiscal_years for each row execute function fiscal_years_close_rules();

-- The accountant opens, closes and locks nothing (0186's trigger, on the years too).
drop trigger if exists books_owner_acts on fiscal_years;
create trigger books_owner_acts before insert or update or delete on fiscal_years for each row execute function books_owner_acts();

-- A closing workspace holds its period history with its books (0188's erasure, re-made).
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

-- The erasure contract, re-made from its latest definition (0188) with the new table.
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
    ('period_locks', 'unrelated', null, null, null, null)
$$;
revoke all on function customer_erasure_contract() from public;

insert into _migrations (version, name) values (189, 'period_close')
  on conflict (version) do nothing;
