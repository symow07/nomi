-- ---------------------------------------------------------------------------
-- 0175 — THE ACCOUNTANT (Phase 5, A5; decision 12).
--
-- The books have three roles: the owner sees, posts and exports; the accountant sees and exports; staff get
-- nothing of them (src/core/conversation/people.ts `booksMay`). An accountant is a person of their own KIND: made
-- by the owner, never the owner, and the kind never changes (a session signed at sign-in carries it). The app
-- confines an accountant to the books' routes; the database refuses an accountant's posting too.
--
-- Closing a workspace waits for the OWNER's copy (0172's rule, the owner's word: "the owner leaves with their books
-- in hand"): a copy an accountant downloaded is theirs, and does not count.
-- ---------------------------------------------------------------------------

alter table people add column if not exists kind text not null default 'team' check (kind in ('team', 'accountant'));
alter table people drop constraint if exists people_owner_is_team;
alter table people add constraint people_owner_is_team check (not (is_owner and kind = 'accountant'));

create or replace function people_kind_fixed() returns trigger
language plpgsql as $$
begin
  if new.kind is distinct from old.kind then
    raise exception 'people: a person keeps the kind they were made with — make another' using errcode = 'NB017';
  end if;
  return new;
end $$;
drop trigger if exists people_kind_fixed on people;
create trigger people_kind_fixed before update of kind on people for each row execute function people_kind_fixed();

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
  -- A5 (0175) — an accountant sees and exports; posting is the owner's (and the app's guard says so first).
  if exists (select 1 from people p where p.id::text = new.posted_by and p.kind = 'accountant') then
    raise exception 'books: an accountant sees and exports the books; posting is the owner''s' using errcode = 'NB016';
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

create or replace function books_export_covers(p_business uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when not exists (select 1 from journal_entries where business_id = p_business and state = 'posted') then true
    else exists (select 1 from books_exports x where x.business_id = p_business
                   and x.covers_through >= (select max(posted_at) from journal_entries where business_id = p_business and state = 'posted')
                   -- A5 (0175) — the OWNER's copy: an accountant's download does not put the books in the owner's hands.
                   and (x.made_by = 'owner' or exists (select 1 from people p where p.id::text = x.made_by and p.is_owner)))
  end
$$;
revoke all on function books_export_covers(uuid) from public;
grant execute on function books_export_covers(uuid) to nomi_app;

insert into _migrations (version, name) values (175, 'accountant')
  on conflict (version) do nothing;
