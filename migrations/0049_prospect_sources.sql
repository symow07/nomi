-- ---------------------------------------------------------------------------
-- 0049 — C5 · M41: a source of prospects, behind one connector shape.
--
-- Apollo is the first source and must not be a special case: the next one (a
-- CSV, Lusha, her own trade-show list) should cost a file, not a rewrite. So
-- nothing here is named for Apollo except the value in a CHECK.
--
--   connector_credentials
--     A HOME FOR A KEY THAT IS NOT A CHANNEL'S. `channel_credentials` is keyed
--     by the thing that routes inbound messages; an enrichment API routes
--     nothing and must not be able to resolve a tenant. Stored ENCRYPTED
--     (AES-256-GCM, `encryptSecret`, CREDENTIAL_KEY) — the first real use of
--     those helpers since M3 wrote them. A fingerprint for the audit line,
--     never the value. One live key per connector; replacing one archives the
--     old row, and nothing is ever erased.
--
--   organization_enrichments
--     WHAT A SOURCE SAID ABOUT A COMPANY, per domain, with when and who asked.
--     A lookup costs her money (Apollo bills per credit), so a domain looked up
--     once is read from here, not bought again. Minimal columns — the ones her
--     page shows — rather than the vendor's whole payload: data nobody reads is
--     data that leaks.
--
--     THIS TABLE IS FOR PEOPLE TO READ. Her employee may never see it: "I see
--     you import homeware" said to someone who never told her is a claim built
--     on a purchased profile. Nothing on the conversation path selects it, and a
--     parity test holds every module that can reach a prompt to that.
--
--   contacts.source += 'apollo', contacts.title
--     Someone she chose from a search. 0036 said 'apollo' arrives with the
--     importer that writes it; this is that importer. The title ("Purchasing
--     Manager") is what makes a search result a person she can judge.
--
-- WHAT IS NOT HERE: a consent evidence for purchased leads. A person found in a
-- search has consented to nothing, and M38's rule — no row means no consent —
-- holds for them exactly as for anyone. Whether B2B e-mail to a business
-- address may rest on "legitimate interest" is a legal decision for the owner,
-- not a default for a migration to take.
-- ---------------------------------------------------------------------------

create table if not exists connector_credentials (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references businesses(id) on delete cascade,
  connector          text not null check (connector in ('apollo')),
  secret_ciphertext  text not null check (secret_ciphertext like 'v1.%'),
  key_version        integer not null default 1,
  fingerprint        text not null check (fingerprint ~ '^[0-9a-f]{12}$'),
  created_by         text not null,
  created_at         timestamptz not null default now(),
  archived_at        timestamptz,
  archived_by        text,
  constraint connector_credentials_archive_whole check ((archived_at is null) = (archived_by is null))
);
create unique index if not exists connector_credentials_one_live
  on connector_credentials (business_id, connector) where archived_at is null;

create table if not exists organization_enrichments (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references businesses(id) on delete cascade,
  domain         text not null check (domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  source         text not null check (source in ('apollo', 'fake')),
  found          boolean not null,
  name           text,
  industry       text,
  employees      integer check (employees is null or employees >= 0),
  country        text,
  city           text,
  website        text,
  linkedin_url   text,
  founded_year   integer,
  looked_up_by   text not null,
  looked_up_at   timestamptz not null default now()
);
create index if not exists organization_enrichments_latest
  on organization_enrichments (business_id, domain, looked_up_at desc);

alter table contacts drop constraint if exists contacts_source_check;
alter table contacts add constraint contacts_source_check
  check (source in ('inbound', 'manual', 'apollo'));
alter table contacts add column if not exists title text;

alter table connector_credentials    enable row level security;
alter table organization_enrichments enable row level security;

do $$
declare t text;
begin
  foreach t in array array['connector_credentials','organization_enrichments'] loop
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_tenant') then
      execute format(
        'create policy %I on %I for all to nomi_app
           using (business_id = current_business_id())
           with check (business_id = current_business_id())', t || '_tenant', t);
    end if;
  end loop;
end $$;

grant select, insert, update on connector_credentials to nomi_app;
grant select, insert on organization_enrichments to nomi_app;
revoke update on organization_enrichments from nomi_app;
revoke delete, truncate on connector_credentials, organization_enrichments from nomi_app;

insert into _migrations (version, name) values (49, 'prospect_sources')
on conflict (version) do nothing;
