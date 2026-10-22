-- ---------------------------------------------------------------------------
-- 0200 — THE REST OF THE BOOKS, SAID BY THE DATABASE TOO (Phase 5, DZ within block S).
--
-- 0186 made the database refuse an accountant's write on invoices, payments, statements and matches; later blocks did
-- the same for credit notes (0188), fiscal years (0189), papers' readings (0191) and custom fields (0192). D7's check
-- found the rest still open underneath: the parties, the chart of accounts, the journals, the tax codes, and a draft
-- entry and its lines. The routes refuse an accountant every one of them, and posting is refused already (0175,
-- NB016); here the database refuses the write itself, the same way (0186's books_owner_acts, NB021), so a route that
-- forgets its guard still changes nothing. The accountant still SEES every one of these tables: they are the books.
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['parties', 'accounts', 'journals', 'tax_codes', 'journal_entries', 'journal_lines'] loop
    execute format('drop trigger if exists books_owner_acts on %I', t);
    execute format('create trigger books_owner_acts before insert or update or delete on %I for each row execute function books_owner_acts()', t);
  end loop;
end $$;

insert into _migrations (version, name) values (200, 'books_owner_acts_rest')
  on conflict (version) do nothing;
