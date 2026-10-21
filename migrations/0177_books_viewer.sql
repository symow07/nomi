-- ---------------------------------------------------------------------------
-- 0177 — AN ACCOUNTANT SEES THE BOOKS AND NOTHING OF THE SALES SIDE, AND THE DATABASE SAYS SO (Phase 5, B0; the
-- owner, 2026-10-22: "a shop's external accountant has no business reading its customers' messages — that's a
-- privacy boundary, not a convenience").
--
-- A5 (0175) confined an accountant with the app's route guard, and the database refused their POSTING (it reads who
-- posted from the entry). A READ names nobody, so until now the database could not tell who was asking. From here
-- every tenant transaction a signed-in request opens says so (`app.viewer_id`, src/db/viewer.ts), and every table
-- under row security outside the books carries one RESTRICTIVE policy more: for an accountant, no row — read,
-- written or changed. Restrictive policies are AND-ed with the tenant policies already there, so for everyone else
-- nothing changes, and outside a request (the worker, the webhooks, the tools) no viewer is set.
--
-- The tables an accountant may see are the books' own, and the workspace's row (its name heads the books' rail).
-- Every other table under row security gets the policy now; a table made later is held by
-- tests/integration/books-viewer.test.ts, which fails until it has the policy or a reason to be on this list.
-- ---------------------------------------------------------------------------

-- Who the viewer is, from the person's own row — never from anything the request says about itself but its id.
create or replace function viewer_is_accountant() returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from people
     where id = nullif(current_setting('app.viewer_id', true), '')::uuid
       and kind = 'accountant')
$$;
revoke all on function viewer_is_accountant() from public;
grant execute on function viewer_is_accountant() to nomi_app;

do $$
declare
  t text;
  sees constant text[] := array[
    -- the books (0169–0175)
    'accounts', 'journals', 'fiscal_years', 'journal_counters', 'journal_entries', 'journal_lines',
    'tax_codes', 'parties', 'custom_field_defs', 'books_settings', 'books_exports', 'documents', 'document_blobs',
    'owner_rates',
    -- the workspace's own row
    'businesses'];
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity and c.relname <> all (sees)
     order by c.relname
  loop
    execute format('drop policy if exists not_for_accountants on %I', t);
    execute format('create policy not_for_accountants on %I as restrictive for all '
                   'using (not (select viewer_is_accountant())) with check (not (select viewer_is_accountant()))', t);
  end loop;
end $$;

insert into _migrations (version, name) values (177, 'books_viewer')
  on conflict (version) do nothing;
