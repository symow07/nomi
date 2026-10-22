-- ---------------------------------------------------------------------------
-- 0207 — IMPORTED HISTORY, KEPT AS A DOCUMENT (Phase 5, E3; the small replacement for D11).
--
-- A workbook read in with entries dated BEFORE the books' open window (before the first day an entry can be written:
-- the earliest open fiscal year's first day, or the day after the lock date) no longer refuses the whole read-in.
-- The entries inside the window go into the books as before. Those before it go nowhere in the books: the FILE is
-- kept as one of A4's documents, marked "history, not in the books" by the two columns below. It is sealed, kept in
-- the workspace's residency, read by the same roles, held and erased with the workspace's papers (0174, 0205),
-- downloaded like any paper and included in the papers copy. No new table.
--
--   · The mark is set when the file is kept and never changed (documents are insert-only, G20): how many entries it
--     held that the books did not take, and the newest one's date.
--   · Its retention date runs from the end of the year of that newest date, plus the law's years (books_retention):
--     the date the law sets for those entries' own papers.
--   · A history document is never an entry's paper (no entry_id) and is never read into a draft (document_readings
--     refuses it): what it holds cannot reach an entry, the trial balance or the FEC.
--   · The same file kept twice as history is one document (one per workspace and SHA-256).
-- ---------------------------------------------------------------------------

alter table documents add column if not exists history_entries integer;
alter table documents add column if not exists history_through date;
alter table documents drop constraint if exists documents_history_shape;
alter table documents add constraint documents_history_shape check (
  (history_entries is null and history_through is null)
  or (history_entries >= 1 and history_through is not null and entry_id is null));
create unique index if not exists documents_history_once on documents (business_id, sha256) where history_entries is not null;

-- documents_rules, re-made from its latest definition (0174): history runs from its newest entry's year.
create or replace function documents_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  y_end date;
  v_years integer;
begin
  if new.history_through is not null then
    y_end := make_date(extract(year from new.history_through)::int, 12, 31);
  elsif new.entry_id is not null then
    select f.ends_on into y_end from journal_entries e join fiscal_years f on f.id = e.fiscal_year_id where e.id = new.entry_id;
  end if;
  y_end := coalesce(y_end, make_date(extract(year from now())::int, 12, 31));
  select coalesce(r.years, d.years) into v_years
    from businesses b left join books_retention r on r.country = b.country
    cross join (select years from books_retention where country = '*') d
   where b.id = new.business_id;
  new.keep_until := (y_end + make_interval(years => v_years))::date;
  return new;
end $$;
revoke all on function documents_rules() from public;

-- History is never read into a draft: nothing it holds becomes an entry.
create or replace function document_readings_not_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from documents where id = new.document_id and history_entries is not null) then
    raise exception 'books: this file is history, not in the books — it is kept, never read into an entry'
      using errcode = 'NB030';
  end if;
  return new;
end $$;
revoke all on function document_readings_not_history() from public;
drop trigger if exists document_readings_not_history on document_readings;
create trigger document_readings_not_history before insert on document_readings
  for each row execute function document_readings_not_history();

insert into _migrations (version, name) values (207, 'history_kept')
  on conflict (version) do nothing;
