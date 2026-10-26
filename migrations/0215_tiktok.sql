-- ---------------------------------------------------------------------------
-- 0215 — TIKTOK DIRECT MESSAGES (PHASE-5.md decision 8; docs/TIKTOK-CHANNEL.md, surface A only — the owner, 2026-10-26).
--
-- A business connects its OWN TikTok account (a Business account with Advanced Access, or verified) through TikTok's
-- Business Messaging API, and the assistant answers the people who write to it, under the same send gate, erasure,
-- roles and row security as every other channel. Built against a recorded fake of TikTok's documented answers;
-- nothing has met TikTok (the access steps are the owner's).
--
--   · 'tiktok' joins the six channel lists: a conversation, a customer's handle, a channel's source, a queued message,
--     a credential and a channel row. The lists are copied from their latest definitions (0203; channels.kind, 0011).
--   · tiktok_accounts — the account a business connected (like meta_accounts, 0054): its TikTok `open_id`, its name,
--     and ONE sealed grant — the access token (a day), the refresh token (a year) and when each ends, together, with
--     CREDENTIAL_KEY (tools/rekey.mjs knows the column). One live account per business, one live business per account.
--     A token TikTok refused is marked (`last_error`), and the page asks to connect again. TikTok sends no message
--     content for a customer in the EEA, Switzerland or the UK (`im_receive_msg_eu`): such a message is only counted
--     here, so the page can say people there wrote and must be answered in TikTok.
--   · A practice copy holds no TikTok account (0086's refusal, on the new table).
--   · No customer's data is in tiktok_accounts: a customer's TikTok handle is a client_channels row, erased with them.
-- ---------------------------------------------------------------------------

alter table conversations   drop constraint if exists conversations_channel_check;
alter table conversations   add  constraint conversations_channel_check
  check (channel in ('whatsapp','wechat','instagram','messenger','rednote','webhook_test','email','web_chat','telegram','tiktok'));

alter table client_channels drop constraint if exists client_channels_channel_check;
alter table client_channels add  constraint client_channels_channel_check
  check (channel in ('whatsapp','wechat','instagram','messenger','rednote','webhook_test','email','web_chat','telegram','tiktok'));

alter table channel_sources drop constraint if exists channel_sources_channel_check;
alter table channel_sources add  constraint channel_sources_channel_check
  check (channel in ('whatsapp','wechat','instagram','messenger','rednote','webhook_test','email','web_chat','telegram','tiktok'));

alter table outbound_messages drop constraint if exists outbound_messages_channel_check;
alter table outbound_messages add  constraint outbound_messages_channel_check
  check (channel in ('whatsapp','email','instagram','messenger','web_chat','telegram','tiktok'));

alter table channel_credentials drop constraint if exists channel_credentials_channel_check;
alter table channel_credentials add  constraint channel_credentials_channel_check
  check (channel in ('whatsapp','wechat','instagram','messenger','rednote','telegram',
                     'webhook_test','email','web_widget','web_chat','tiktok'));

alter table channels drop constraint if exists channels_kind_check;
alter table channels add  constraint channels_kind_check
  check (kind in ('whatsapp','instagram','messenger','wechat','rednote','telegram','line','email','web_chat','tiktok'));

create table if not exists tiktok_accounts (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references businesses(id) on delete cascade,
  open_id            text not null check (open_id ~ '^[A-Za-z0-9._-]{8,128}$'),
  username           text not null default '' check (length(username) <= 64),
  token_ciphertext   text not null check (token_ciphertext like 'v1.%'),
  key_version        integer not null default 1,
  fingerprint        text not null check (fingerprint ~ '^[0-9a-f]{12}$'),
  scopes             text not null,
  connected_by       text not null,
  connected_at       timestamptz not null default now(),
  needs_attention_at timestamptz,
  last_error         text check (last_error is null or last_error in ('revoked', 'refused')),
  eu_messages        integer not null default 0 check (eu_messages >= 0),
  eu_last_at         timestamptz,
  archived_at        timestamptz,
  archived_by        text,
  constraint tiktok_accounts_archive_whole check ((archived_at is null) = (archived_by is null)),
  constraint tiktok_accounts_attention_whole check ((needs_attention_at is null) = (last_error is null))
);
create unique index if not exists tiktok_accounts_one_live on tiktok_accounts (business_id) where archived_at is null;
create unique index if not exists tiktok_accounts_account_live on tiktok_accounts (open_id) where archived_at is null;

alter table tiktok_accounts enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'tiktok_accounts' and policyname = 'tiktok_accounts_tenant') then
    create policy tiktok_accounts_tenant on tiktok_accounts
      for all to nomi_app
      using (business_id = current_business_id())
      with check (business_id = current_business_id());
  end if;
end $$;
grant select, insert, update on tiktok_accounts to nomi_app;
revoke delete, truncate on tiktok_accounts from nomi_app;

-- A practice copy can reach nobody (0086): its refusal, on the new table.
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'tiktok_accounts_practice_refuses') then
    create trigger tiktok_accounts_practice_refuses before insert or update on tiktok_accounts
      for each row execute function practice_refuses();
  end if;
end $$;

-- What a delivery says about the ACCOUNT, before any tenant is known — so security definer, and it does only this,
-- on the live account the delivery was for: its username (TikTok names the account in each message), and a message
-- from a customer in the EEA, Switzerland or the UK (`im_receive_msg_eu`), which carries no content and no customer
-- and so is only counted.
create or replace function tiktok_note_delivery(p_open_id text, p_username text, p_eu boolean) returns void
language sql security definer set search_path = public, pg_temp as $$
  update tiktok_accounts
     set username = case when p_username is not null and p_username ~ '^[A-Za-z0-9._]{1,64}$' then p_username else username end,
         eu_messages = eu_messages + case when p_eu then 1 else 0 end,
         eu_last_at = case when p_eu then now() else eu_last_at end
   where open_id = p_open_id and archived_at is null
$$;
revoke all on function tiktok_note_delivery(text, text, boolean) from public;
grant execute on function tiktok_note_delivery(text, text, boolean) to nomi_app;

insert into _migrations (version, name) values (215, 'tiktok')
  on conflict (version) do nothing;
