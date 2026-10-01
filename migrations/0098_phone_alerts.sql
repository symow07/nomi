-- 0098 — the owner's phone, and a reply that waited too long (G5b, the
-- onboarding plan's phase 4; decision 35).
--
--   · `push_subscriptions` — a phone (or a browser) that asked for alerts: the
--     address its push service gave it and the two keys the alert is
--     encrypted to (RFC 8291). One row per address; a phone the push service
--     says is gone is archived, never deleted. Whoever turned it on is named.
--   · `expire_waiting_drafts()` — a reply waiting for approval on a channel
--     that allows an answer only within a day of the customer's last message
--     (WhatsApp, Instagram, Messenger) is marked `expired` once that day has
--     passed. Until now it stayed pending, and Send was refused by the channel
--     or the gate. Run every ten minutes; it reads every workspace, so it is
--     security definer, like practice_expire (0089). The status exists since 0009.
--
-- A phone's address names a person, not a customer: a customer's erasure
-- never reaches it, a workspace's erasure takes it (both tools find a table by
-- its columns), and the practice copy takes none.

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  person_id uuid references people(id),
  endpoint text not null check (endpoint like 'https://%' and length(endpoint) <= 2000),
  p256dh text not null check (length(p256dh) between 80 and 100),
  auth text not null check (length(auth) between 16 and 32),
  -- What the browser said it is, cut short: so the owner can tell two phones apart.
  device text check (device is null or length(device) <= 120),
  created_at timestamptz not null default now(),
  last_sent_at timestamptz,
  archived_at timestamptz,
  archived_reason text check (archived_reason is null or archived_reason in ('removed', 'gone'))
);
create unique index if not exists push_subscriptions_live
  on push_subscriptions (business_id, endpoint) where archived_at is null;

alter table push_subscriptions enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'push_subscriptions' and policyname = 'push_subscriptions_tenant') then
    create policy push_subscriptions_tenant on push_subscriptions for all to nomi_app
      using (business_id = current_business_id()) with check (business_id = current_business_id());
  end if;
end $$;
grant select, insert, update on push_subscriptions to nomi_app;
revoke delete, truncate on push_subscriptions from nomi_app;

create or replace function expire_waiting_drafts() returns integer
language sql security definer set search_path = public as $$
  with gone as (
    update drafts d set status = 'expired', decided_at = now()
      from conversations c
      join client_channels cc on cc.client_id = c.client_id and cc.channel = c.channel
     where d.conversation_id = c.id
       and d.status = 'pending'
       and c.channel in ('whatsapp', 'instagram', 'messenger')
       and cc.last_inbound_at < now() - interval '24 hours'
    returning d.id
  )
  select count(*)::integer from gone
$$;
revoke all on function expire_waiting_drafts() from public;
grant execute on function expire_waiting_drafts() to nomi_app;

insert into _migrations (version, name) values (98, 'phone_alerts')
on conflict (version) do nothing;
