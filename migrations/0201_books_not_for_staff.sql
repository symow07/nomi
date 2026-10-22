-- ---------------------------------------------------------------------------
-- 0201 — STAFF GET NOTHING OF THE BOOKS, SAID BY THE DATABASE TOO (Phase 5, DZ within block S).
--
-- Decision 12 (A5): the owner sees, posts and exports the books; the accountant sees and exports; STAFF — the team —
-- keep the sales work they always had and get nothing of the books. The routes held that (booksMay); underneath, a
-- request made as a member of the team read and wrote the books like the owner's (found 2026-10-22: a team viewer
-- read the chart of accounts and added an account to it). Here the database holds it as 0177 holds the accountant to
-- the books: a restrictive policy on each of the books' own tables, so a team member's request sees no row of them and
-- writes none, whatever a route forgets.
--
-- The books' own tables only. Not here, because the sales side reads them too: the workspace row (businesses), the
-- books' settings (the documents' residency), the documents store and its blobs (A4), and the owner's exchange rates
-- (a quote in another currency). The owner, the accountant and a request with no viewer (the worker, the tools) are
-- untouched by this policy.
-- ---------------------------------------------------------------------------

-- Who the viewer is, from the person's own row — never from anything the request says about itself but its id.
create or replace function viewer_is_staff() returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from people
     where id = nullif(current_setting('app.viewer_id', true), '')::uuid
       and not is_owner and kind = 'team')
$$;
revoke all on function viewer_is_staff() from public;
grant execute on function viewer_is_staff() to nomi_app;

do $$
declare t text;
begin
  foreach t in array array[
    'accounts', 'journals', 'fiscal_years', 'journal_counters', 'journal_entries', 'journal_lines',
    'tax_codes', 'tax_start_dates', 'parties', 'custom_field_defs', 'books_exports',
    'connector_records', 'books_connections',
    'invoice_counters', 'invoices', 'invoice_lines', 'invoice_payments',
    'statement_imports', 'statement_lines', 'statement_matches',
    'credit_note_counters', 'credit_notes', 'credit_note_lines',
    'period_locks', 'document_readings'] loop
    execute format('drop policy if exists not_for_staff on %I', t);
    execute format('create policy not_for_staff on %I as restrictive for all '
                   'using (not (select viewer_is_staff())) with check (not (select viewer_is_staff()))', t);
  end loop;
end $$;

insert into _migrations (version, name) values (201, 'books_not_for_staff')
  on conflict (version) do nothing;
