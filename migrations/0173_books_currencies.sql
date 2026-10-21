-- ---------------------------------------------------------------------------
-- 0173 — THE BOOKS IN ONE CURRENCY, AT THE OWNER'S RATES (Phase 5, A3; decision 13).
--
-- A workspace keeps its books in ONE currency (`books_settings.book_currency`: the workspace's currency, fixed by
-- the first posting). A line may be in another: at posting, each such line is turned into the books' currency at
-- the OWNER's rate for that pair (`owner_rates`, append-only since 0031) — the latest she stated on or before the
-- entry's day. The rate, the moment she stated it and the row it came from are written ON THE LINE, with the books'
-- amounts, and the line is never changed again: a report run years later gives the same figures, whatever rates she
-- states afterwards. No rate stated for the pair: the posting is refused, saying which pair and which day. Never a
-- live rate, never the inverse of the pair she did state (a rate she did not write is not hers).
--
-- An entry balances in each FOREIGN currency in its own amounts, and in the books' currency on the converted amounts
-- of all its lines (0169's "in each currency", made exact for the books' own: a line in the books' currency is the
-- same either way, and an exchange difference — a cent lost to rounding — is a line of its own in the books'
-- currency, drafted like any other, never invented by the database).
-- ---------------------------------------------------------------------------

alter table books_settings add column if not exists book_currency text
  check (book_currency is null or book_currency in ('USD', 'CNY', 'AED', 'SAR', 'BRL', 'MXN', 'INR', 'IDR', 'MAD', 'EUR', 'GBP'));

alter table journal_lines add column if not exists book_debit  numeric(18,2) check (book_debit is null or book_debit >= 0);
alter table journal_lines add column if not exists book_credit numeric(18,2) check (book_credit is null or book_credit >= 0);
alter table journal_lines add column if not exists rate numeric(18,6) check (rate is null or rate > 0);
alter table journal_lines add column if not exists rate_stated_at timestamptz;
-- Cascades only for an operator's purge: the app deletes no rate (0031), and a posted line refuses any change (0169).
alter table journal_lines add column if not exists rate_id uuid references owner_rates(id) on delete cascade;
alter table journal_lines drop constraint if exists journal_lines_rate_whole;
alter table journal_lines add constraint journal_lines_rate_whole
  check ((rate is null) = (rate_id is null) and (rate is null) = (rate_stated_at is null)
         and (book_debit is null) = (book_credit is null));

-- The books' currency: as fixed by the first posting, else the workspace's.
create or replace function books_currency(p_business uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select book_currency from books_settings where business_id = p_business),
                  (select currency from businesses where id = p_business))
$$;
revoke all on function books_currency(uuid) from public;
grant execute on function books_currency(uuid) to nomi_app;

-- In each foreign currency, the entry's debits equal its credits; and it has two lines at least. (The books' own
-- currency is checked on the converted amounts, at posting.)
create or replace function journal_entry_unbalanced(p_entry uuid) returns text
language sql stable as $$
  select case
    when (select count(*) from journal_lines where entry_id = p_entry) < 2 then 'an entry needs two lines at least'
    else (select string_agg(format('%s: debits %s, credits %s', currency, d, c), '; ' order by currency)
            from (select l.currency, sum(l.debit) as d, sum(l.credit) as c from journal_lines l
                   join journal_entries e on e.id = l.entry_id
                   where l.entry_id = p_entry and l.currency <> books_currency(e.business_id) group by l.currency) t
           where d <> c)
  end
$$;


-- Once anything is posted, the books' currency stays what it was.
create or replace function books_settings_rules() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.book_currency is not null and new.book_currency is distinct from old.book_currency
     and exists (select 1 from journal_entries where business_id = old.business_id and state = 'posted')
     and not books_purge_allowed() then
    raise exception 'books: the books are kept in %, fixed by the first posting', old.book_currency using errcode = 'NB015';
  end if;
  return new;
end $$;
drop trigger if exists books_settings_rules on books_settings;
create trigger books_settings_rules before update on books_settings for each row execute function books_settings_rules();

create or replace function journal_entries_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  why text;
  n integer;
  orig record;
  book text;
  l record;
  r record;
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

  -- A3 (0173) — every line in the books' own currency: as it is, or at the OWNER's rate for its pair, the latest she
  -- stated on or before the entry's day. Never a live rate, never the inverse of the other pair, never recomputed:
  -- the rate, the day she stated it and the row it came from are written on the line, which is never changed again.
  book := books_currency(new.business_id);
  for l in select id, currency, debit, credit from journal_lines where entry_id = new.id loop
    if l.currency = book then
      update journal_lines set book_debit = l.debit, book_credit = l.credit, rate = null, rate_stated_at = null, rate_id = null
       where id = l.id;
    else
      select id, rate, stated_at into r from owner_rates
       where business_id = new.business_id and from_currency = l.currency and to_currency = book
         and stated_at < (new.entry_date + 1)::timestamptz
       order by stated_at desc, created_at desc limit 1;
      if r.id is null then
        raise exception 'books: no rate of yours for % to % on or before % — state one, then post', l.currency, book, new.entry_date
          using errcode = 'NB014';
      end if;
      update journal_lines set rate = r.rate, rate_stated_at = r.stated_at, rate_id = r.id,
             book_debit = round(l.debit * r.rate, 2), book_credit = round(l.credit * r.rate, 2)
       where id = l.id;
    end if;
  end loop;
  -- And it balances in the books' currency too: a cent lost to rounding is a line of its own (exchange difference),
  -- written by whoever drafts the entry, never invented here.
  why := (select format('%s: debits %s, credits %s', book, sum(book_debit), sum(book_credit))
            from journal_lines where entry_id = new.id having sum(book_debit) <> sum(book_credit));
  if why is not null and exists (select 1 from journal_lines where entry_id = new.id and currency <> book) then
    raise exception 'books: the entry does not balance in the books'' currency — %; add the exchange difference as a line', why
      using errcode = 'NB009';
  elsif why is not null then
    raise exception 'books: the entry does not balance — %', why using errcode = 'NB009';
  end if;
  -- The books' currency is fixed by the first posting.
  insert into books_settings (business_id, book_currency) values (new.business_id, book)
  on conflict (business_id) do update set book_currency = excluded.book_currency where books_settings.book_currency is null;
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

create or replace function journal_lines_rules() returns trigger
language plpgsql as $$
declare
  s text;
  day date;
  t record;
begin
  select state, entry_date into s, day from journal_entries where id = coalesce(new.entry_id, old.entry_id);
  if s = 'posted' and not books_purge_allowed() then
    raise exception 'books: the entry is posted, and its lines are never changed — reverse it' using errcode = 'NB005';
  end if;
  if s = 'discarded' and not books_purge_allowed() then
    raise exception 'books: the draft was discarded, and its lines stay as they were' using errcode = 'NB005';
  end if;
  -- A3 — while drafted, the books' figures are not the drafter's to write: the posting writes them, at the owner's
  -- rate (journal_entries_rules). A draft line's book amounts and rate are cleared whenever the line changes.
  if tg_op <> 'DELETE' and s = 'draft' and pg_trigger_depth() = 1 then
    new.book_debit := null; new.book_credit := null; new.rate := null; new.rate_stated_at := null; new.rate_id := null;
  end if;
  if tg_op = 'UPDATE' and new.entry_id <> old.entry_id then
    raise exception 'books: a line stays on its entry' using errcode = 'NB005';
  end if;
  if tg_op <> 'DELETE' and new.tax_code_id is not null then
    select * into t from tax_codes where id = new.tax_code_id;
    if day < t.valid_from or (t.valid_to is not null and day >= t.valid_to) then
      raise exception 'books: tax code % is not in force on %', t.code, day using errcode = 'NB012';
    end if;
  end if;
  return coalesce(new, old);
end $$;

-- A closing workspace holds its rates with its books (0172's erasure, re-made): the lines were turned at them.
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
                          'owner_rates'];
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
  -- on; everything else of the workspace goes. And the owner leaves with them FIRST (the owner, 2026-10-22): no
  -- export covering the last posting, no closure.
  v_hold := exists (select 1 from journal_entries e where e.business_id = p_business and e.state = 'posted');
  v_keep := books_keep_until(p_business);
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

insert into _migrations (version, name) values (173, 'books_currencies')
  on conflict (version) do nothing;
