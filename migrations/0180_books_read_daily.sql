-- ---------------------------------------------------------------------------
-- 0180 — THE MORNING'S READ OF EVERY CONNECTED SYSTEM (Phase 5, B5; item 13, part 1).
--
-- Once a day the worker reads each connected system (Google Sheets, Odoo) into the books, as the owner's "Read it
-- in" does: entries as drafts, the same change recorded once, the cursor kept. It needs to know WHICH — across
-- workspaces, which the app's role cannot see — and nothing more: this lists the workspace and the system of every
-- connection that is connected, in a workspace that is open and whose books are shown. No setting, no grant, no
-- name leaves it.
-- ---------------------------------------------------------------------------

create or replace function books_connections_due()
  returns table (business_id uuid, system text)
  language sql stable security definer set search_path = public, pg_temp as $$
  select c.business_id, c.system
    from books_connections c join businesses b on b.id = c.business_id
   where c.state = 'connected' and b.is_active and b.books_area
   order by c.business_id, c.system
$$;
revoke all on function books_connections_due() from public;
grant execute on function books_connections_due() to nomi_app;

insert into _migrations (version, name) values (180, 'books_read_daily')
  on conflict (version) do nothing;
