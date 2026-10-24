-- 0213 — THE STALE GRANT, FOR GOOGLE SHEETS TOO (the owner, 2026-10-24: "same rule as QuickBooks and Xero").
--
-- Connecting Google Sheets again archived the old grant and left its refresh token live at Google. Google's revocation
-- ends the whole grant — the new one too, if it came after — so Sheets now follows 0212's order: given back before the
-- consent, kept track of when Google does not confirm it, shown, and tried again every hour.
--
-- How long a stale grant is worth trying: as long as its token can still work there. Intuit's refresh token lives 100
-- days, Xero's 60; Google's has no fixed end, and expires after six months unused — a stale one is never used, so 183.

-- stale_grant_workspaces, re-made from its latest definition (0212): Google Sheets joins, each system with its own life.
create or replace function stale_grant_workspaces() returns table (business_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select distinct k.business_id from connector_credentials k
   where k.archived_at is not null and k.stale_since is not null and k.revoked_at is null
     and k.connector in ('xero', 'quickbooks', 'sheets')
     and k.created_at > now() - case when k.connector = 'sheets' then interval '183 days' else interval '100 days' end
$$;
revoke all on function stale_grant_workspaces() from public;
grant execute on function stale_grant_workspaces() to nomi_app;

insert into _migrations (version, name) values (213, 'stale_grants_sheets')
  on conflict (version) do nothing;
