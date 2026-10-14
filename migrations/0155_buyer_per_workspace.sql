-- ---------------------------------------------------------------------------
-- 0155 — A BUYER'S ADDRESS IS EACH WORKSPACE'S OWN (2026-10-14, found building
-- the operator tool for decision 1: a second WhatsApp number, a second
-- workspace).
--
-- `client_channels` was UNIQUE on (channel, channel_user_id) across ALL
-- businesses (0005). So a buyer who had written to one workspace could never
-- be reached by another: the second workspace's `ensureConversation` saw no
-- row (row security hides the first one's), made a client, and lost the
-- address to `on conflict do nothing` — a client with no address, a new one
-- with every message, and replies with nowhere to go. Nothing crossed; the
-- second workspace simply lost the buyer. With two numbers live, the first
-- person to hit it is anyone who writes to both — the owner testing them.
--
-- Now the address is unique per workspace: (business_id, channel,
-- channel_user_id). `business_id` is the client's, filled by a trigger from
-- `clients` so every writer — the app, the seeds, the tests — gets it right
-- without naming it, and backfilled for every row there is.
-- ---------------------------------------------------------------------------

alter table client_channels add column if not exists business_id uuid references businesses(id) on delete cascade;

update client_channels cc set business_id = cl.business_id
  from clients cl where cl.id = cc.client_id and cc.business_id is null;

alter table client_channels alter column business_id set not null;

-- The client's business, always: a row cannot name another workspace than its client's.
create or replace function client_channels_business() returns trigger
language plpgsql set search_path = public as $$
begin
  new.business_id := (select business_id from clients where id = new.client_id);
  return new;
end $$;

drop trigger if exists client_channels_business on client_channels;
create trigger client_channels_business before insert or update of client_id, business_id on client_channels
  for each row execute function client_channels_business();

alter table client_channels drop constraint if exists client_channels_channel_channel_user_id_key;
create unique index if not exists client_channels_one_per_business
  on client_channels (business_id, channel, channel_user_id);

insert into _migrations (version, name) values (155, 'buyer_per_workspace')
  on conflict (version) do nothing;
