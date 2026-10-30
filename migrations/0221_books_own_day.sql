-- ---------------------------------------------------------------------------
-- 0221 — A YEAR IS LOCKED AND CLOSED ON THE WORKSPACE'S OWN DAY (2026-10-31; audit batch 5, polish).
--
-- books_lock_to and books_close_year asked `current_date`: the database's day, UTC. A workspace behind UTC could
-- close its year while its own last day was still running (its 31 December evening is 1 January in UTC), and every
-- entry dated that day after it was refused. Both now ask books_today(b), the workspace's own day (0211), as the
-- periods do. A year is closed once its last day has ENDED there: ends_on before today, never on it.
--
-- Re-made from their newest definitions: books_lock_to (0211), books_close_year (0219). Nothing else changes.
-- ---------------------------------------------------------------------------

-- books_lock_to, re-made from 0211: today at the latest, the workspace's today.
create or replace function books_lock_to(p_day date, p_by text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b uuid := current_business_id(); y record; first record;
begin
  if b is null then raise exception 'books: no workspace' using errcode = 'NB023'; end if;
  if viewer_is_not_owner() then raise exception 'books: locking the books is the owner''s' using errcode = 'NB024'; end if;
  if p_day is null or p_day > books_today(b) then
    raise exception 'books: the books lock up to a day that has passed, today at the latest' using errcode = 'NB023';
  end if;
  select * into y from fiscal_years where business_id = b and state = 'open' and p_day between starts_on and ends_on for update;
  if y.id is null then raise exception 'books: % is in no open fiscal year', p_day using errcode = 'NB023'; end if;
  if y.lock_date is not null and p_day <= y.lock_date then
    raise exception 'books: the year is locked to % already — a lock moves only forward; to move it back, reopen', y.lock_date using errcode = 'NB023';
  end if;
  select item, n into first from books_close_checklist(b, p_day) where n > 0 limit 1;
  if first.item is not null then
    raise exception 'books: the checklist is not clear for % — %: %', p_day, first.item, first.n using errcode = 'NB023';
  end if;
  update fiscal_years set lock_date = p_day where id = y.id;
  insert into period_locks (business_id, fiscal_year_id, action, from_date, to_date, by_person) values (b, y.id, 'lock', y.lock_date, p_day, p_by);
end $$;
revoke all on function books_lock_to(date, text) from public;
grant execute on function books_lock_to(date, text) to nomi_app;

-- books_close_year, re-made from 0219: the year's last day must have ENDED in the workspace's own day.
create or replace function books_close_year(p_year uuid, p_result_account uuid, p_journal uuid, p_by text, p_label text, p_ref text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b uuid := current_business_id(); y record; first record; book text; e uuid; line integer := 0; total numeric := 0; r record;
begin
  if b is null then raise exception 'books: no workspace' using errcode = 'NB023'; end if;
  if viewer_is_not_owner() then raise exception 'books: closing a year is the owner''s' using errcode = 'NB024'; end if;
  select * into y from fiscal_years where id = p_year and business_id = b for update;
  if y.id is null or y.state <> 'open' then raise exception 'books: that fiscal year is not open' using errcode = 'NB023'; end if;
  if y.ends_on >= books_today(b) then raise exception 'books: a year is closed once it has ended (%)', y.ends_on using errcode = 'NB023'; end if;
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
  if y.lock_date is null or y.lock_date < y.ends_on then
    update fiscal_years set lock_date = y.ends_on where id = y.id;
    insert into period_locks (business_id, fiscal_year_id, action, from_date, to_date, by_person) values (b, y.id, 'lock', y.lock_date, y.ends_on, p_by);
  end if;
  book := books_currency(b);
  insert into books_closing_marks (xact) values (txid_current()) on conflict do nothing;
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
  delete from books_closing_marks where xact = txid_current();
  update fiscal_years set state = 'closed', closed_at = now(), closed_by = p_by where id = y.id;
  insert into period_locks (business_id, fiscal_year_id, action, from_date, to_date, by_person) values (b, y.id, 'close', y.starts_on, y.ends_on, p_by);
  return e;
end $$;
revoke all on function books_close_year(uuid, uuid, uuid, text, text, text) from public;
grant execute on function books_close_year(uuid, uuid, uuid, text, text, text) to nomi_app;

insert into _migrations (version, name) values (221, 'books_own_day')
  on conflict (version) do nothing;
