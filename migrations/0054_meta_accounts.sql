-- ---------------------------------------------------------------------------
-- 0054 — C10: the Facebook Page (and the Instagram account linked to it) a
-- business connected ITSELF, so its replies leave as that business.
--
-- Until now the Page and the Instagram account were the host's, set in the
-- environment: one installation, one Page, every reply signed "Nomi does".
-- A business that signs up presses Connect, chooses its own Page in Meta's
-- dialog, and what is kept is the one thing that lets the product answer as
-- it later: the PAGE TOKEN, encrypted like every other credential (AES-256-GCM,
-- CREDENTIAL_KEY), with a fingerprint for the audit line. The 0050 shape,
-- because a mailbox and a Page are the same kind of thing to this product: an
-- account she lends it, which it must be able to give back.
--
--   ONE PAGE AT A TIME, per business — and ONE BUSINESS PER PAGE. Two live rows
--   for one business would make "which account answered?" a question with two
--   answers; two businesses on one Page would put one factory's buyers in the
--   other's inbox. The second index is global, and RLS hides the other tenant's
--   row, so the conflict is how a business learns the Page is taken.
--
--   `needs_attention_at` / `last_error`
--     A Page token dies when she changes her Facebook password, removes the app,
--     or loses the Page. The sender records it the first time Meta refuses, so
--     the page says "connect it again" instead of every reply after it failing
--     with nobody told.
--
-- The token here is the one Meta calls long-lived (no expiry); there is no
-- refresh token to hold. A database dump would carry a live key to her Page,
-- which is exactly why it is encrypted and the key is not in the database.
-- ---------------------------------------------------------------------------

create table if not exists meta_accounts (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references businesses(id) on delete cascade,
  page_id            text not null check (page_id ~ '^[0-9]{5,}$'),
  page_name          text not null,
  ig_account_id      text check (ig_account_id is null or ig_account_id ~ '^[0-9]{5,}$'),
  ig_username        text,
  token_ciphertext   text not null check (token_ciphertext like 'v1.%'),
  key_version        integer not null default 1,
  fingerprint        text not null check (fingerprint ~ '^[0-9a-f]{12}$'),
  scopes             text not null,
  connected_by       text not null,
  connected_at       timestamptz not null default now(),
  needs_attention_at timestamptz,
  last_error         text check (last_error is null or last_error in ('revoked', 'refused')),
  archived_at        timestamptz,
  archived_by        text,
  constraint meta_accounts_archive_whole check ((archived_at is null) = (archived_by is null)),
  constraint meta_accounts_attention_whole check ((needs_attention_at is null) = (last_error is null))
);
create unique index if not exists meta_accounts_one_live
  on meta_accounts (business_id) where archived_at is null;
create unique index if not exists meta_accounts_page_live
  on meta_accounts (page_id) where archived_at is null;

alter table meta_accounts enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'meta_accounts' and policyname = 'meta_accounts_tenant') then
    create policy meta_accounts_tenant on meta_accounts
      for all to nomi_app
      using (business_id = current_business_id())
      with check (business_id = current_business_id());
  end if;
end $$;

grant select, insert, update on meta_accounts to nomi_app;
revoke delete, truncate on meta_accounts from nomi_app;

insert into _migrations (version, name) values (54, 'meta_accounts')
on conflict (version) do nothing;
