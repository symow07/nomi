-- ---------------------------------------------------------------------------
-- 0205 — THE OWNER'S COPY OF THEIR PAPERS (Phase 5, E1; the launch blocker).
--
-- An owner downloads every paper of the workspace in one archive, with an index of what is in it
-- (/app/settings/data/papers.zip). Its receipt is a `books_exports` row of the new kind 'papers_zip': who made it, the
-- number of papers it holds and the newest one's time. Closing a workspace that holds papers then waits for the
-- OWNER's own copy of every one of them, as it waits for the owner's books copy (0172, 0175): an accountant's download
-- does not put the papers in the owner's hands, and a paper added after the copy makes it old again. The archive is
-- made whole or not at all: a paper that cannot be opened stops it, no receipt is written, and closure does not finish.
--
-- No new table: the receipt joins the books copy's own, already classified for erasure and row security.
-- ---------------------------------------------------------------------------

alter table books_exports drop constraint if exists books_exports_kind_check;
alter table books_exports add constraint books_exports_kind_check check (kind in ('books_csv', 'papers_zip'));
alter table books_exports add column if not exists papers integer check (papers is null or papers >= 0);
alter table books_exports drop constraint if exists books_exports_papers_shape;
alter table books_exports add constraint books_exports_papers_shape check ((kind = 'papers_zip') = (papers is not null));

-- books_export_covers, re-made from its latest definition (0175): a papers receipt is not a books copy.
create or replace function books_export_covers(p_business uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when not exists (select 1 from journal_entries where business_id = p_business and state = 'posted') then true
    else exists (select 1 from books_exports x where x.business_id = p_business and x.kind = 'books_csv'
                   and x.covers_through >= (select max(posted_at) from journal_entries where business_id = p_business and state = 'posted')
                   -- A5 (0175) — the OWNER's copy: an accountant's download does not put the books in the owner's hands.
                   and (x.made_by = 'owner' or exists (select 1 from people p where p.id::text = x.made_by and p.is_owner)))
  end
$$;
revoke all on function books_export_covers(uuid) from public;
grant execute on function books_export_covers(uuid) to nomi_app;

-- The owner's copy of every paper: a receipt of theirs holding at least as many papers as there are, and reaching the
-- newest. Papers are never changed or deleted while the workspace is open, so that is every one of them.
create or replace function papers_export_covers(p_business uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from documents where business_id = p_business)
      or exists (select 1 from books_exports x where x.business_id = p_business and x.kind = 'papers_zip'
                   and x.papers >= (select count(*) from documents where business_id = p_business)
                   and x.covers_through >= (select max(created_at) from documents where business_id = p_business)
                   and (x.made_by = 'owner' or exists (select 1 from people p where p.id::text = x.made_by and p.is_owner)))
$$;
revoke all on function papers_export_covers(uuid) from public;
grant execute on function papers_export_covers(uuid) to nomi_app;

-- erase_workspace_rows, re-made from its latest definition (0191): the papers wait for the owner's copy (NE012).
create or replace function erase_workspace_rows(p_business uuid, p_dry boolean, p_restored boolean default false)
returns jsonb
language plpgsql volatile security definer set search_path = public set row_security = off as $$
declare
  v_ids uuid[];
  v_id uuid;
  v_step record;
  v_n bigint;
  v_active bigint := 0;
  v_tables jsonb := '{}';
  v_copies jsonb := '{}';
  -- A2.4 — the books a closing workspace must keep (0169–0172), and until when.
  v_books text[] := array['books_settings', 'accounts', 'journals', 'fiscal_years', 'journal_counters', 'journal_entries',
                          'journal_lines', 'tax_codes', 'parties', 'custom_field_defs', 'books_exports',
                          -- A3 (0173): the owner's rates the posted lines were turned at.
                          'owner_rates',
                          -- C2 (0184): the invoices, their lines, their numbering and their payments.
                          'invoice_counters', 'invoices', 'invoice_lines', 'invoice_payments',
                          -- C3 (0185): the statements read in and the matches made against them.
                          'statement_imports', 'statement_lines', 'statement_matches',
                          -- D1b (0188): the credit notes, their lines and their numbering.
                          'credit_note_counters', 'credit_notes', 'credit_note_lines',
                          -- D2 (0189): every lock and reopening of the books' periods.
                          'period_locks',
                          -- D6 (0191): what was read from the papers, and the drafts made from it.
                          'document_readings',
                          -- A4 (0174): the papers behind the entries.
                          'documents', 'document_blobs'];
  v_hold boolean;
  v_keep date;
begin
  if not exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise exception 'erasure: the role % is subject to row-level security, so it cannot see every row it must erase', current_user
      using errcode = 'NE009';
  end if;
  if not exists (select 1 from businesses where id = p_business) then
    raise exception 'erasure: no workspace %', p_business using errcode = 'NE004';
  end if;
  v_ids := array(select id from businesses where practice_of = p_business order by id) || p_business;
  -- A2.4 — posted books are the statutory record: they stay until the legal date, with the business row they hang
  -- on; everything else of the workspace goes. And the owner leaves with them FIRST (the owner, 2026-10-21): no
  -- export covering the last posting, no closure.
  v_hold := exists (select 1 from journal_entries e where e.business_id = p_business and e.state = 'posted')
         -- A4 (0174): papers are the record too, attached yet or not.
         or exists (select 1 from documents x where x.business_id = p_business);
  -- A4 (0174): the later of the books' date and the papers' own.
  v_keep := greatest(books_keep_until(p_business), (select max(keep_until) from documents where business_id = p_business));
  -- E1 (0205): the papers too are taken first, every time — now with a way to take them: until the OWNER's own copy of
  -- every paper exists (papers_export_covers), a workspace holding papers does not close.
  if not p_dry and exists (select 1 from documents x where x.business_id = p_business) and not papers_export_covers(p_business) then
    raise exception 'books: this workspace keeps papers (receipts, invoices, bills), and the owner has not downloaded every one of them — download them first; nothing was changed'
      using errcode = 'NE012';
  end if;
  if v_hold and not p_dry and not books_export_covers(p_business) then
    raise exception 'books: this workspace keeps books, and they were not downloaded since the last entry was posted — download them first; nothing was changed'
      using errcode = 'NE011';
  end if;
  if not v_hold then
    -- Nothing posted: drafts, accounts and settings are not the record, and go with the rest.
    perform set_config('nomi.books_purge', 'workspace-erasure', true);
  end if;
  if not p_dry then
    perform set_config('lock_timeout', '15s', true);
    -- Every insert that names the business waits on this, then finds it gone.
    perform 1 from businesses where id = any(v_ids) for update;
  end if;
  if to_regclass('pgboss.job') is not null and not p_restored and not p_dry then
    execute $q$select count(*) from pgboss.job where data->>'businessId' = any($1) and state::text = 'active'$q$
      into v_active using array(select x::text from unnest(v_ids) x);
    if v_active > 0 then
      raise exception 'erasure: a worker is running % job(s) for this workspace right now; nothing was changed — try again in a minute', v_active
        using errcode = 'NE002';
    end if;
  end if;
  if p_restored and to_regclass('pgboss.job') is not null and not p_dry then
    execute $q$delete from pgboss.job where data->>'businessId' = any($1) and state::text = 'active'$q$
      using array(select x::text from unnest(v_ids) x);
  end if;
  foreach v_id in array v_ids loop
    for v_step in select * from workspace_erasure_steps() loop
      if v_hold and v_id = p_business and (v_step.label = any(v_books) or v_step.label = 'businesses') then
        continue;
      end if;
      if p_dry then
        execute v_step.count_sql into v_n using v_id;
      else
        execute v_step.run_sql using v_id;
        get diagnostics v_n = row_count;
      end if;
      if v_id = p_business then
        v_tables := erasure_add(v_tables, v_step.label, coalesce((v_tables->>v_step.label)::bigint, 0) + v_n);
      else
        v_copies := erasure_add(v_copies, v_step.label, coalesce((v_copies->>v_step.label)::bigint, 0) + v_n);
      end if;
    end loop;
  end loop;
  if v_hold and not p_dry then
    update businesses set is_active = false, books_closed_at = now(), books_held_until = v_keep where id = p_business;
  end if;
  if not p_dry and exists (select 1 from businesses where id = any(v_ids) and not (v_hold and id = p_business)) then
    raise exception 'erasure: the workspace is still there after the erasure. Rolled back; nothing changed.' using errcode = 'NE010';
  end if;
  return jsonb_build_object('tables', v_tables, 'copies', v_copies,
                            'rows', erasure_total(v_tables) + erasure_total(v_copies))
      || case when v_hold then jsonb_build_object('books_held_until', v_keep) else '{}'::jsonb end;
end $$;
revoke all on function erase_workspace_rows(uuid, boolean, boolean) from public;

insert into _migrations (version, name) values (205, 'papers_copy')
  on conflict (version) do nothing;
