-- 0241 — A bank match names only its own workspace's journal line (the authorization audit, Block 7).
--
-- `statement_matches.journal_line_id` is a single-column foreign key, and a foreign key's check runs past row security.
-- The one guard on it, `statement_matches_rules()` (0185), runs as the caller: for the app role, another workspace's
-- journal line was simply not there, so `j` was null and every test it made (`j.state <> 'posted'`, `s.account_id <>
-- j.account_id`, the amounts) was null rather than true — none raised, and the row was written. Through
-- `POST /app/books/bank/match` (the journal line's id comes from the form), workspace A could match its statement line
-- to workspace B's journal line; B's own match of that line was then refused by `statement_matches_one_per_journal_line`,
-- for a reason B cannot see.
--
-- The rule now reads both lines in the match's own workspace (row security does this for the app role; the explicit
-- `business_id` does it for any role that bypasses it) and refuses one it does not find, with SQLSTATE 23503 as 0239's
-- references do. Every comparison is null-safe. Deletes, updates and the setting-aside of a match are unchanged.
--
-- The foreign key stays as it is (single-column), so the erasure walks see the same edge.
--
-- EXISTING ROWS. A trigger checks new writes only: this migration first counts live and set-aside matches whose
-- journal line or statement line belongs to another workspace, and stops, naming the count, if there is one.

do $$
declare n bigint;
begin
  select count(*) into n
    from statement_matches m
    join journal_lines l on l.id = m.journal_line_id
   where l.business_id <> m.business_id;
  if n > 0 then
    raise exception '0241: % bank match(es) already point at another workspace''s journal line; nothing was changed', n;
  end if;
end $$;

-- Re-made from 0185_reconciliation.sql (its latest definition): the same rule, with both lines read in the match's own
-- workspace and every comparison null-safe.
create or replace function statement_matches_rules() returns trigger
language plpgsql as $$
declare
  s record; j record;
begin
  if tg_op = 'DELETE' then
    if books_purge_allowed() then return old; end if;
    raise exception 'books: a match is set aside, never deleted' using errcode = 'NB020';
  end if;
  if tg_op = 'UPDATE' then
    if books_purge_allowed() then return new; end if;
    if old.unmatched_at is null and new.unmatched_at is not null
       and (to_jsonb(new) - 'unmatched_at' - 'unmatched_by') = (to_jsonb(old) - 'unmatched_at' - 'unmatched_by') then
      return new;
    end if;
    raise exception 'books: a match is made or set aside, nothing else' using errcode = 'NB020';
  end if;
  if new.unmatched_at is not null then
    raise exception 'books: a match is made first' using errcode = 'NB020';
  end if;
  select account_id, amount, currency into s
    from statement_lines where id = new.statement_line_id and business_id = new.business_id;
  if not found then
    raise exception 'books: a statement line is matched only in its own workspace' using errcode = '23503';
  end if;
  select l.account_id, l.debit, l.credit, l.currency, e.state into j
    from journal_lines l join journal_entries e on e.id = l.entry_id
   where l.id = new.journal_line_id and l.business_id = new.business_id and e.business_id = new.business_id;
  if not found then
    raise exception 'books: a statement line is matched only to a journal line of its own workspace' using errcode = '23503';
  end if;
  if j.state is distinct from 'posted' then
    raise exception 'books: a statement line is matched to a posted entry' using errcode = 'NB020';
  end if;
  if s.account_id is distinct from j.account_id or s.currency is distinct from j.currency
     or (s.amount > 0 and j.debit is distinct from s.amount) or (s.amount < 0 and j.credit is distinct from -s.amount) then
    raise exception 'books: a statement line is matched to a line of the same account and amount' using errcode = 'NB020';
  end if;
  return new;
end $$;

insert into _migrations (version, name) values (241, 'bank_match_own_lines')
  on conflict (version) do nothing;
