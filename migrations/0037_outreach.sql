-- 0037 — M42: her decision to write first, per channel.
--
-- ENABLING OUTREACH IS ITS OWN DECISION, separate from activation. Working
-- credentials mean the provider is reachable; activation means she decided to
-- go live with replies; this means she decided that a message may go to someone
-- who never wrote to her. They are three different sentences and the product
-- has been careful about the first two since M20.1.
--
-- HISTORY, NOT STATE, exactly as owner_rates and sample_policy: turning it on
-- inserts, turning it off inserts, and the most recent row per channel is the
-- one in force. A refusal from March is still explained by the row that was
-- current then, and "reversible in one tap" is an insert rather than an erase.
--
-- ONLY CHANNELS THAT CAN INITIATE. Instagram and Messenger are absent, and not
-- as an oversight: the API cannot carry an uninvited message on either, so a
-- row enabling one would be a setting with nothing behind it — a switch the
-- owner could flip that changes nothing, which is worse than no switch. A
-- parity test holds this list against the M39 registry so the two cannot drift.
create table if not exists outreach_settings (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  channel      text not null check (channel in ('email','whatsapp')),
  enabled      boolean not null,
  at           timestamptz not null default now(),
  -- WHOSE decision. It is owner-only, and the row says which owner.
  by_actor     text not null default 'owner'
);

create index if not exists outreach_settings_current
  on outreach_settings (business_id, channel, at desc);

alter table outreach_settings enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                  where tablename = 'outreach_settings' and policyname = 'outreach_settings_tenant') then
    create policy outreach_settings_tenant on outreach_settings
      for all to nomi_app
      using (business_id = current_business_id())
      with check (business_id = current_business_id());
  end if;
end $$;

-- Insert-only. A decision that can be edited after the fact is not a record of
-- what she decided; it is a record of what someone last wanted it to say.
grant select, insert on outreach_settings to nomi_app;
revoke update on outreach_settings from nomi_app;

insert into _migrations (version, name)
values (37, 'outreach')
on conflict (version) do nothing;
