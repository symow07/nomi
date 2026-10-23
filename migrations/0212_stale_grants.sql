-- 0212 — THE STALE GRANT (the owner, 2026-10-23; PROGRESS "the next block, first item").
--
-- Connecting QuickBooks or Xero again while connected archived the old grant here and left its refresh token live at
-- Intuit or Xero (up to 100 days at Intuit, 60 at Xero): a credential that outlived the owner's intent. Now the old
-- grant is given back BEFORE the new consent (src/books/staleGrants.ts) — before, because Xero's revocation removes
-- every connection the person made and Intuit's disconnects the company: given back after, it could take the new
-- grant with it. Disconnecting gives it back as before. A grant replaced or archived that the system did not confirm
-- given back is kept track of here — on its own sealed row, never a copy of it — shown on the books' page, and tried
-- again every hour until the system confirms or the token's life is over there.
--
--   stale_since    when Nomi stopped using a grant the system had not confirmed given back (null: in use, or done)
--   revoke_tries   how many times giving it back was tried
--   revoked_at     when the system confirmed it (or said the token is not one it honours)
--
-- A STALE GRANT is an archived row with stale_since set and revoked_at null, younger than the longest token life
-- (Intuit's 100 days). Nothing here is deleted: the app role keeps no DELETE on the table (0049).

alter table connector_credentials
  add column if not exists stale_since      timestamptz,
  add column if not exists revoke_tries     integer not null default 0 check (revoke_tries >= 0),
  add column if not exists revoked_at       timestamptz;

create index if not exists connector_credentials_stale on connector_credentials (business_id, connector)
  where archived_at is not null and stale_since is not null and revoked_at is null;

-- The workspaces holding a stale grant, for the worker's hourly round (security definer: across workspaces, ids only).
create or replace function stale_grant_workspaces() returns table (business_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select distinct k.business_id from connector_credentials k
   where k.archived_at is not null and k.stale_since is not null and k.revoked_at is null
     and k.connector in ('xero', 'quickbooks') and k.created_at > now() - interval '100 days'
$$;
revoke all on function stale_grant_workspaces() from public;
grant execute on function stale_grant_workspaces() to nomi_app;

insert into _migrations (version, name) values (212, 'stale_grants')
  on conflict (version) do nothing;
