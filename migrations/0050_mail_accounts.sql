-- ---------------------------------------------------------------------------
-- 0050 — C6 · M50: the mailbox her e-mail leaves from.
--
-- Until now every mail went into a recording fake: C4 was built so the one
-- missing piece was "something that actually hands a message to a mail server",
-- and this is it. She connects Gmail or Outlook with a few clicks (OAuth), and
-- what is kept is the one thing that lets the product send as her later: a
-- REFRESH TOKEN, encrypted like every other credential (AES-256-GCM,
-- CREDENTIAL_KEY), with a fingerprint for the audit line.
--
--   ONE SENDING MAILBOX AT A TIME, per business. Two live rows would make "which
--   address did that mail leave from?" a question with two answers. Connecting
--   another archives the first; nothing is erased.
--
--   `needs_attention_at` / `last_error`
--     A refresh token dies quietly — she changes her Google password, an admin
--     revokes the app, Microsoft rotates a policy. The transport records it here
--     the first time a send is refused, so the connect page shows "connect it
--     again" instead of every mail after it failing with nobody told.
--
-- NO ACCESS TOKEN IS STORED. It lives an hour, is fetched from the refresh token
-- when a mail needs sending, and is held only in the sending process's memory.
-- A database dump would otherwise carry a live key to her mailbox.
-- ---------------------------------------------------------------------------

create table if not exists mail_accounts (
  id                        uuid primary key default gen_random_uuid(),
  business_id               uuid not null references businesses(id) on delete cascade,
  provider                  text not null check (provider in ('google', 'microsoft')),
  address                   text not null check (address ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  refresh_token_ciphertext  text not null check (refresh_token_ciphertext like 'v1.%'),
  key_version               integer not null default 1,
  fingerprint               text not null check (fingerprint ~ '^[0-9a-f]{12}$'),
  scopes                    text not null,
  connected_by              text not null,
  connected_at              timestamptz not null default now(),
  needs_attention_at        timestamptz,
  last_error                text check (last_error is null or last_error in ('revoked', 'refused')),
  archived_at               timestamptz,
  archived_by               text,
  constraint mail_accounts_archive_whole check ((archived_at is null) = (archived_by is null)),
  constraint mail_accounts_attention_whole check ((needs_attention_at is null) = (last_error is null))
);
create unique index if not exists mail_accounts_one_live
  on mail_accounts (business_id) where archived_at is null;

alter table mail_accounts enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'mail_accounts' and policyname = 'mail_accounts_tenant') then
    create policy mail_accounts_tenant on mail_accounts
      for all to nomi_app
      using (business_id = current_business_id())
      with check (business_id = current_business_id());
  end if;
end $$;

grant select, insert, update on mail_accounts to nomi_app;
revoke delete, truncate on mail_accounts from nomi_app;

insert into _migrations (version, name) values (50, 'mail_accounts')
on conflict (version) do nothing;
