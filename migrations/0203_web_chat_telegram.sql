-- ---------------------------------------------------------------------------
-- 0203 — TWO MORE CHANNELS: THE BUSINESS'S CHAT PAGE, AND TELEGRAM (Phase 5, S7; item 22; decision 8).
--
-- A conversation, a buyer's handle, a channel's source, a queued message and a credential may now be on
-- 'web_chat' (the business's own chat page, served by Nomi) and 'telegram' (Nomi's bot, reached through the
-- business's own start link). `channels.kind` has allowed both since 0011. Nothing else changes: each is a channel
-- like the others, under the same send gate, the same erasure (a buyer's chat handle is a client_channels row) and
-- the same row security.
-- ---------------------------------------------------------------------------

alter table conversations   drop constraint if exists conversations_channel_check;
alter table conversations   add  constraint conversations_channel_check
  check (channel in ('whatsapp','wechat','instagram','messenger','rednote','webhook_test','email','web_chat','telegram'));

alter table client_channels drop constraint if exists client_channels_channel_check;
alter table client_channels add  constraint client_channels_channel_check
  check (channel in ('whatsapp','wechat','instagram','messenger','rednote','webhook_test','email','web_chat','telegram'));

alter table channel_sources drop constraint if exists channel_sources_channel_check;
alter table channel_sources add  constraint channel_sources_channel_check
  check (channel in ('whatsapp','wechat','instagram','messenger','rednote','webhook_test','email','web_chat','telegram'));

alter table outbound_messages drop constraint if exists outbound_messages_channel_check;
alter table outbound_messages add  constraint outbound_messages_channel_check
  check (channel in ('whatsapp','email','instagram','messenger','web_chat','telegram'));

alter table channel_credentials drop constraint if exists channel_credentials_channel_check;
alter table channel_credentials add  constraint channel_credentials_channel_check
  check (channel in ('whatsapp','wechat','instagram','messenger','rednote','telegram',
                     'webhook_test','email','web_widget','web_chat'));

insert into _migrations (version, name) values (203, 'web_chat_telegram')
  on conflict (version) do nothing;
