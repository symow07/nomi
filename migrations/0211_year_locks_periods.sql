-- ---------------------------------------------------------------------------
-- 0211 — A LOCK DATE FOR EACH FISCAL YEAR, AND AVIS 24's PERIODS ON TOP OF IT (Phase 5, D10; the owner, 2026-10-24,
-- option A).
--
-- ONE PREDICATE DECIDES A WRITE, AND ONLY ONE: an entry is writable iff its date is after ITS OWN fiscal year's lock
-- (`books_day_writable`: the year open, the day inside it, after `fiscal_years.lock_date`). Nothing else grants or
-- denies a write. The workspace-wide lock (`books_settings.lock_date`, 0169/0189) is gone: one date could not keep the
-- previous year's closing period open while the current year moved on (docs/PHASE-5.md, R1).
--
-- AVIS 24 §2.3 d) IS A RULE ON THE SET OF LOCKS, not on writes: at any moment, for a Moroccan workspace whose books
-- have started, at most two current periods are open in the exercice in progress (the period of today and the one
-- before), plus the previous exercice's closing period (its last period), plus the opening entry's period (the start
-- day, inside the first of those). `books_period_floors` says, for the workspace's local day, the lowest each open
-- year's lock may be; `books_roll_periods` raises a lock that is below its floor (the worker runs it every hour, so a
-- period that has just begun closes the oldest); `books_reopen_year` refuses a reopening that would go below one.
-- 0169 caps open fiscal years at two, so there are at most two live locks — and the floors name at most two years.
--
-- THE BOOKS' START (`books_settings.books_start`, set once by the owner, with the period length): periods exist from
-- it forward; its own year's lock is set to the day before, so nothing before it is written by hand. Anything dated
-- before it is history (E3: set apart at import, kept as a file, never in the books).
--
-- The closing entry is still posted inside `books_close_year` on the day its own close locks (0189's one exception,
-- unchanged, open to that function only).
-- ---------------------------------------------------------------------------

alter table fiscal_years add column if not exists lock_date date;
alter table fiscal_years drop constraint if exists fiscal_years_lock_inside;
alter table fiscal_years add constraint fiscal_years_lock_inside
  check (lock_date is null or (lock_date >= starts_on - 1 and lock_date <= ends_on));

alter table books_settings add column if not exists books_start date;
alter table books_settings add column if not exists period_length text not null default 'month';
alter table books_settings add column if not exists books_started_by text;
alter table books_settings add column if not exists books_started_at timestamptz;
alter table books_settings drop constraint if exists books_settings_period_length;
alter table books_settings add constraint books_settings_period_length check (period_length in ('month', 'quarter'));
alter table books_settings drop constraint if exists books_settings_started;
alter table books_settings add constraint books_settings_started
  check ((books_start is null) = (books_started_at is null) and (books_start is null) = (books_started_by is null));

alter table period_locks add column if not exists fiscal_year_id uuid references fiscal_years(id) on delete cascade;
alter table period_locks drop constraint if exists period_locks_action_check;
alter table period_locks add constraint period_locks_action_check check (action in ('lock', 'reopen', 'close', 'start', 'period'));

-- Each year takes its part of the workspace's lock: all of it when the lock passed the year's end, up to the lock when
-- the lock fell inside it, nothing when it fell before. (No workspace in production holds books: test databases only.)
do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'books_settings' and column_name = 'lock_date') then
    alter table fiscal_years disable trigger user;
    execute $u$
      update fiscal_years f set lock_date = case when s.lock_date >= f.ends_on then f.ends_on
                                                 when s.lock_date >= f.starts_on then s.lock_date else null end
        from books_settings s where s.business_id = f.business_id and s.lock_date is not null and f.state = 'open'$u$;
    execute $u$
      update fiscal_years f set lock_date = f.ends_on where f.state = 'closed'$u$;
    alter table fiscal_years enable trigger user;
  end if;
end $$;

-- ── the one predicate ─────────────────────────────────────────────────────────────────────────────────────────────
-- books_day_writable, re-made from its latest definition (0189): the lock is the entry's OWN year's.
create or replace function books_day_writable(p_business uuid, p_fiscal_year uuid, p_day date) returns text
language sql stable as $$
  select case
    when f.id is null then 'no such fiscal year'
    when f.state <> 'open' then format('fiscal year %s to %s is closed', f.starts_on, f.ends_on)
    when p_day < f.starts_on or p_day > f.ends_on then format('%s is outside fiscal year %s to %s', p_day, f.starts_on, f.ends_on)
    when f.lock_date is not null and p_day <= f.lock_date
         and not (current_user <> 'nomi_app' and coalesce(current_setting('nomi.closing', true), '') = 'on')
      then format('%s is on or before the lock date %s', p_day, f.lock_date)
    else null end
  from (select 1) one
  left join fiscal_years f on f.id = p_fiscal_year and f.business_id = p_business
$$;

-- ── who may move a lock, a start, a length ────────────────────────────────────────────────────────────────────────
-- A year's lock moves only through the functions below (security definer: not the app's own statements).
create or replace function fiscal_year_lock_rules() returns trigger
language plpgsql as $$
begin
  if current_user <> 'nomi_app' then return new; end if;
  if (tg_op = 'INSERT' and new.lock_date is not null) or (tg_op = 'UPDATE' and new.lock_date is distinct from old.lock_date) then
    raise exception 'books: a lock date moves only by locking (forward, the checklist clear), by the periods, or by reopening (the owner''s, with a reason)'
      using errcode = 'NB023';
  end if;
  return new;
end $$;
drop trigger if exists fiscal_year_lock_rules on fiscal_years;
create trigger fiscal_year_lock_rules before insert or update on fiscal_years for each row execute function fiscal_year_lock_rules();

-- books_lock_rules, re-made from its latest definition (0189): it guards the books' start and its period length now
-- (the workspace-wide lock is gone).
create or replace function books_lock_rules() returns trigger
language plpgsql as $$
begin
  if current_user <> 'nomi_app' then return new; end if;
  if (tg_op = 'INSERT' and (new.books_start is not null or new.period_length <> 'month'))
     or (tg_op = 'UPDATE' and (new.books_start is distinct from old.books_start or new.period_length is distinct from old.period_length
                               or new.books_started_by is distinct from old.books_started_by or new.books_started_at is distinct from old.books_started_at)) then
    raise exception 'books: the books start once, with their periods, by starting them' using errcode = 'NB023';
  end if;
  return new;
end $$;

-- ── periods ───────────────────────────────────────────────────────────────────────────────────────────────────────
-- The first day of the period holding p_day, in a year that starts on p_year_start: months (or quarters) from it.
create or replace function books_period_start(p_year_start date, p_length text, p_day date) returns date
language sql immutable as $$
  select (p_year_start + make_interval(months => (
      (extract(year from age(p_day, p_year_start))::int * 12 + extract(month from age(p_day, p_year_start))::int)
        / (case p_length when 'quarter' then 3 else 1 end)) * (case p_length when 'quarter' then 3 else 1 end)))::date
$$;

-- The workspace's own day, in its time zone: a period begins at local midnight.
create or replace function books_today(p_business uuid) returns date
language sql stable security definer set search_path = public, pg_temp as $$
  select (now() at time zone coalesce((select nullif(timezone, '') from businesses where id = p_business), 'UTC'))::date
$$;

-- The day the periods are kept for: the workspace's own, always, for the app. A tool or a test (any other role) may
-- name another, through `nomi.books_day`, to see a month that has not come yet.
create or replace function books_reference_day(p_business uuid) returns date
language sql stable security definer set search_path = public, pg_temp as $$
  select case when session_user <> 'nomi_app' and coalesce(current_setting('nomi.books_day', true), '') <> ''
              then current_setting('nomi.books_day', true)::date else books_today(p_business) end
$$;
revoke all on function books_reference_day(uuid) from public;

-- AVIS 24 §2.3 d), ON THE SET OF LOCKS: the lowest each open year's lock may be on p_day. Empty unless the workspace is
-- Moroccan and its books have started.
--   · the exercice in progress (the open year holding p_day, else the latest open one begun): its current period and
--     the one before stay open; its lock reaches the day before that one began;
--   · an earlier open year: only its LAST period (the closing period) stays open;
--   · the opening entry's period is the start day, inside the first of those: nothing more to keep open for it.
create or replace function books_period_floors(p_business uuid, p_day date)
returns table (fiscal_year uuid, floor date) language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  s record; c record; p record; len text; cur date; prev date;
begin
  select b.country, bs.books_start, bs.period_length into s from businesses b left join books_settings bs on bs.business_id = b.id where b.id = p_business;
  if s.country is distinct from 'MA' or s.books_start is null then return; end if;
  len := s.period_length;
  select * into c from fiscal_years where business_id = p_business and state = 'open' and starts_on <= p_day
   order by starts_on desc limit 1;
  if c.id is null then return; end if;
  cur := books_period_start(c.starts_on, len, least(p_day, c.ends_on));
  prev := case when cur = c.starts_on then c.starts_on
               else books_period_start(c.starts_on, len, cur - 1) end;
  fiscal_year := c.id; floor := prev - 1; return next;
  for p in select * from fiscal_years where business_id = p_business and state = 'open' and ends_on < c.starts_on loop
    fiscal_year := p.id; floor := books_period_start(p.starts_on, len, p.ends_on) - 1; return next;
  end loop;
end $$;
revoke all on function books_period_floors(uuid, date) from public;
grant execute on function books_period_floors(uuid, date) to nomi_app;

-- Where the set of locks breaks the ceiling on p_day: each open year whose lock is below its floor.
create or replace function books_period_problems(p_business uuid, p_day date)
returns table (fiscal_year uuid, lock_date date, floor date) language sql stable security definer set search_path = public, pg_temp as $$
  select f.id, f.lock_date, x.floor from books_period_floors(p_business, p_day) x join fiscal_years f on f.id = x.fiscal_year
   where coalesce(f.lock_date, f.starts_on - 1) < x.floor
$$;
revoke all on function books_period_problems(uuid, date) from public;
grant execute on function books_period_problems(uuid, date) to nomi_app;

-- The periods kept to the ceiling: each lock below its floor raised to it, recorded as the periods' doing. The day is
-- the workspace's own; a day passed in is honoured only from a role other than the app's (the tools, the tests).
create or replace function books_roll_periods(p_business uuid, p_day date default null) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d date := case when p_day is null or session_user = 'nomi_app' then books_reference_day(p_business) else p_day end;
  r record; n integer := 0;
begin
  for r in select * from books_period_problems(p_business, d) loop
    update fiscal_years set lock_date = r.floor where id = r.fiscal_year;
    insert into period_locks (business_id, fiscal_year_id, action, from_date, to_date, by_person)
      values (p_business, r.fiscal_year, 'period', r.lock_date, r.floor, 'nomi');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function books_roll_periods(uuid, date) from public;
grant execute on function books_roll_periods(uuid, date) to nomi_app;

-- The workspaces whose periods the worker keeps: Moroccan, books started (for its hourly round).
create or replace function books_period_workspaces() returns table (business_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.business_id from books_settings s join businesses b on b.id = s.business_id
   where s.books_start is not null and b.country = 'MA' and b.is_active
$$;
revoke all on function books_period_workspaces() from public;
grant execute on function books_period_workspaces() to nomi_app;

-- ── the books' start ──────────────────────────────────────────────────────────────────────────────────────────────
-- Once, by the owner: the day the books begin and their period length. Its year's lock goes to the day before, so
-- nothing before it is entered by hand; the periods are then kept at once.
create or replace function books_start(p_day date, p_length text, p_by text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b uuid := current_business_id(); y record; started date;
begin
  if b is null then raise exception 'books: no workspace' using errcode = 'NB023'; end if;
  if viewer_is_not_owner() then raise exception 'books: starting the books is the owner''s' using errcode = 'NB024'; end if;
  select books_start into started from books_settings where business_id = b;
  if started is not null then raise exception 'books: the books started on % already, once', started using errcode = 'NB023'; end if;
  if p_length is null or p_length not in ('month', 'quarter') then raise exception 'books: periods are months or quarters' using errcode = 'NB023'; end if;
  select * into y from fiscal_years where business_id = b and state = 'open' and p_day between starts_on and ends_on for update;
  if y.id is null then raise exception 'books: the books start inside an open fiscal year' using errcode = 'NB023'; end if;
  insert into books_settings (business_id, books_start, period_length, books_started_by, books_started_at) values (b, p_day, p_length, p_by, now())
    on conflict (business_id) do update set books_start = excluded.books_start, period_length = excluded.period_length,
      books_started_by = excluded.books_started_by, books_started_at = excluded.books_started_at, updated_at = now();
  if coalesce(y.lock_date, y.starts_on - 1) < p_day - 1 then
    update fiscal_years set lock_date = p_day - 1 where id = y.id;
  end if;
  insert into period_locks (business_id, fiscal_year_id, action, from_date, to_date, by_person) values (b, y.id, 'start', y.lock_date, p_day - 1, p_by);
  perform books_roll_periods(b);
end $$;
revoke all on function books_start(date, text, text) from public;
grant execute on function books_start(date, text, text) to nomi_app;

-- ── locking, reopening, closing: per year ─────────────────────────────────────────────────────────────────────────
-- books_lock_to, re-made from its latest definition (0189): it locks the year holding the day, and no other.
create or replace function books_lock_to(p_day date, p_by text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b uuid := current_business_id(); y record; first record;
begin
  if b is null then raise exception 'books: no workspace' using errcode = 'NB023'; end if;
  if viewer_is_not_owner() then raise exception 'books: locking the books is the owner''s' using errcode = 'NB024'; end if;
  if p_day is null or p_day > current_date then
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

-- Moving a year's lock BACK (or lifting it, null): the owner's, with a reason — never below the books' start, and
-- never so far that Avis 24's ceiling breaks for today (the set of locks is checked after the move).
drop function if exists books_reopen_to(date, text, text);
create or replace function books_reopen_year(p_year uuid, p_day date, p_by text, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b uuid := current_business_id(); y record; started date; bad record;
begin
  if b is null then raise exception 'books: no workspace' using errcode = 'NB023'; end if;
  if viewer_is_not_owner() then raise exception 'books: reopening the books is the owner''s' using errcode = 'NB024'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'books: a reopening says why' using errcode = 'NB023';
  end if;
  select * into y from fiscal_years where id = p_year and business_id = b and state = 'open' for update;
  if y.id is null then raise exception 'books: that fiscal year is not open' using errcode = 'NB023'; end if;
  if y.lock_date is null or (p_day is not null and (p_day >= y.lock_date or p_day < y.starts_on - 1)) then
    raise exception 'books: reopening moves the year''s lock back, before %', coalesce(y.lock_date::text, 'a lock') using errcode = 'NB023';
  end if;
  select books_start into started from books_settings where business_id = b;
  if started is not null and started between y.starts_on and y.ends_on and coalesce(p_day, y.starts_on - 1) < started - 1 then
    raise exception 'books: the books start on %; nothing before it reopens', started using errcode = 'NB023';
  end if;
  update fiscal_years set lock_date = case when p_day is null or p_day < y.starts_on then null else p_day end where id = y.id;
  select * into bad from books_period_problems(b, books_reference_day(b)) limit 1;
  if bad.fiscal_year is not null then
    raise exception 'books: Avis 24 keeps two current periods open at most: that year stays locked to % at least', bad.floor using errcode = 'NB023';
  end if;
  insert into period_locks (business_id, fiscal_year_id, action, from_date, to_date, reason, by_person)
    values (b, y.id, 'reopen', y.lock_date, p_day, btrim(p_reason), p_by);
end $$;
revoke all on function books_reopen_year(uuid, date, text, text) from public;
grant execute on function books_reopen_year(uuid, date, text, text) to nomi_app;

-- books_close_year, re-made from its latest definition (0189): it locks the YEAR to its last day.
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
  insert into period_locks (business_id, fiscal_year_id, action, from_date, to_date, by_person) values (b, y.id, 'close', y.starts_on, y.ends_on, p_by);
  return e;
end $$;
revoke all on function books_close_year(uuid, uuid, uuid, text, text, text) from public;
grant execute on function books_close_year(uuid, uuid, uuid, text, text, text) to nomi_app;

-- The workspace-wide lock goes: every function that read it reads its year's now.
alter table books_settings drop column if exists lock_date;

insert into _migrations (version, name) values (211, 'year_locks_periods')
  on conflict (version) do nothing;
