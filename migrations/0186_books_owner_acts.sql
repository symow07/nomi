-- ---------------------------------------------------------------------------
-- 0186 — WHAT AN ACCOUNTANT MAY NOT DO TO THE BOOKS, SAID BY THE DATABASE (Phase 5, C4; the owner's B0 note).
--
-- An accountant sees and exports the books; posting is the owner's, and 0175 refuses an accountant's posting at the
-- database (NB016) — an invoice's issue and a payment post entries, so those are refused already. What 0175 does not
-- cover is the rest of C2 and C3: an invoice's draft and its lines, a payment's record, a statement read in, a match.
-- The routes refuse an accountant all of these first; here the database does too, the same way, so a route that
-- forgets its guard still changes nothing. They SEE every one of these tables (they are the books: 0177's policy does
-- not hold them, tests/integration/books-viewer.test.ts lists them).
--
-- Named to fire before each table's own rules (Postgres fires a table's BEFORE triggers in name order).
-- ---------------------------------------------------------------------------

create or replace function books_owner_acts() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
begin
  if (select viewer_is_accountant()) then
    raise exception 'books: an accountant sees and exports the books; this is the owner''s' using errcode = 'NB021';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

do $$
declare t text;
begin
  foreach t in array array['invoices', 'invoice_lines', 'invoice_payments', 'statement_imports', 'statement_lines', 'statement_matches'] loop
    execute format('drop trigger if exists books_owner_acts on %I', t);
    execute format('create trigger books_owner_acts before insert or update or delete on %I for each row execute function books_owner_acts()', t);
  end loop;
end $$;

insert into _migrations (version, name) values (186, 'books_owner_acts')
  on conflict (version) do nothing;
