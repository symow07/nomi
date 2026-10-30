-- ---------------------------------------------------------------------------
-- 0219 — A LOCKED PERIOD IS LOCKED TO THE APP TOO (audit batch 3, B10, 2026-10-30).
--
-- While a year is being closed, its own closing entry is dated inside the lock that close just set, so the lock
-- predicate let a write through "while closing". It knew closing by a SETTING: `nomi.closing = 'on'` and a
-- current_user other than the app. But the predicate runs inside the entry trigger, a SECURITY DEFINER function
-- (0175), where current_user is always the owner — so the setting alone decided, and any role can set a setting:
-- `select set_config('nomi.closing', 'on', true)` and the app could post into a locked month (reproduced against a
-- scratch database, 2026-10-30). A rule is gated on a role, never a setting.
--
-- Now "a close is under way" is a ROW only the closing function can write: `books_closing_marks`, one row per
-- transaction (txid_current()), written by books_close_year (security definer) at the point it set the setting and
-- removed where it cleared it. The app role has no privilege on the table at all, and a transaction that aborts
-- takes its row with it. `books_close_under_way()` (security definer) is the one reader: the lock predicate and the
-- closing journal's rule (0189) ask it. The setting is read by nothing any more.
--
-- Re-made from their newest definitions: books_day_writable and books_close_year (0211), closing_journal_rules (0189).
-- ---------------------------------------------------------------------------

create table if not exists books_closing_marks (
  xact bigint primary key,
  at timestamptz not null default now()
);
-- The default privileges (0005) give the app insert and update on every new table: not this one. Nothing but the
-- closing function may say a close is under way.
revoke all on books_closing_marks from nomi_app;
revoke all on books_closing_marks from public;

create or replace function books_close_under_way() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from books_closing_marks where xact = txid_current())
$$;
revoke all on function books_close_under_way() from public;
grant execute on function books_close_under_way() to nomi_app;

-- books_day_writable, re-made from 0211: the lock gives way only to a close under way in this very transaction.
create or replace function books_day_writable(p_business uuid, p_fiscal_year uuid, p_day date) returns text
language sql stable as $$
  select case
    when f.id is null then 'no such fiscal year'
    when f.state <> 'open' then format('fiscal year %s to %s is closed', f.starts_on, f.ends_on)
    when p_day < f.starts_on or p_day > f.ends_on then format('%s is outside fiscal year %s to %s', p_day, f.starts_on, f.ends_on)
    when f.lock_date is not null and p_day <= f.lock_date
         and not books_close_under_way()
      then format('%s is on or before the lock date %s', p_day, f.lock_date)
    else null end
  from (select 1) one
  left join fiscal_years f on f.id = p_fiscal_year and f.business_id = p_business
$$;

-- books_close_year, re-made from 0211: the close says it is under way with its row, not a setting.
create or replace function books_close_year(p_year uuid, p_result_account uuid, p_journal uuid, p_by text, p_label text, p_ref text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b uuid := current_business_id(); y record; first record; book text; e uuid; line integer := 0; total numeric := 0; r record;
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

-- closing_journal_rules, re-made from 0189: the closing journal takes the closing entry, written by the close.
create or replace function closing_journal_rules() returns trigger
language plpgsql as $$
begin
  if books_close_under_way() or books_purge_allowed() then return new; end if;
  if (select kind from journals where id = new.journal_id) = 'closing' then
    raise exception 'books: the closing journal takes only the closing entry, written when a year is closed' using errcode = 'NB025';
  end if;
  return new;
end $$;

insert into _migrations (version, name) values (219, 'books_closing_marks')
  on conflict (version) do nothing;
