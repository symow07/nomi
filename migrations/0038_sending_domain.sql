-- 0038 — M40.1: the domain she sends from, and whether the world agrees.
--
-- HER DOMAIN, HER REPUTATION. Mail goes out as her own address, so a
-- misconfigured record damages the domain she has used with buyers for years —
-- not ours. That is the right way round, and it is also why this is a gate
-- rather than a warning: the damage is silent, gradual and outlives the
-- campaign that caused it.
--
-- WHAT IS STORED IS A CACHE OF A DNS LOOKUP, and it is stored as one. DNS is
-- slow and external, so checking on every send is not viable; a check that
-- never expires is a claim about the past wearing the clothes of the present.
-- `checked_at` is therefore not decoration — `mayUseDomain` refuses a result
-- older than its TTL, and the column exists so it can.
create table if not exists sending_domains (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id) on delete cascade,
  domain        text not null check (domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  -- The DKIM selector the provider gave her. Part of the record's HOST, so the
  -- page cannot tell her what to add without it.
  dkim_selector text not null default 'nomi',
  -- The last result, per record. NULL means never checked, which is a different
  -- fact from 'missing' and refuses with a different sentence.
  spf_state     text check (spf_state   in ('missing','malformed','unauthorized','ok')),
  dkim_state    text check (dkim_state  in ('missing','malformed','unauthorized','ok')),
  dmarc_state   text check (dmarc_state in ('missing','malformed','unauthorized','ok')),
  checked_at    timestamptz,
  added_at      timestamptz not null default now(),
  added_by      text not null default 'owner'
);

-- One sending domain per business. Not a partial index and no archive column:
-- unlike a contact, an old sending domain is not a record she keeps — it is a
-- setting she replaced, and two live ones would make "which do we send as?"
-- ambiguous at exactly the moment it must not be.
create unique index if not exists sending_domains_one_per_business
  on sending_domains (business_id);

alter table sending_domains enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                  where tablename = 'sending_domains' and policyname = 'sending_domains_tenant') then
    create policy sending_domains_tenant on sending_domains
      for all to nomi_app
      using (business_id = current_business_id())
      with check (business_id = current_business_id());
  end if;
end $$;

-- UPDATABLE, unlike the insert-only tables around it, because this is a cache
-- and a setting rather than a record of something she said. Re-checking must
-- overwrite, or the freshness the gate depends on could never improve.
--
-- NO DELETE, like everywhere else. Changing her sending domain is an update on
-- the one row; there is no "remove it" because removing it is not the control
-- she wants — turning writing-first off is, and that already exists and is
-- recorded. A grant nobody needs is a grant that gets used for something else.
grant select, insert, update on sending_domains to nomi_app;
revoke delete on sending_domains from nomi_app;

insert into _migrations (version, name)
values (38, 'sending_domain')
on conflict (version) do nothing;
