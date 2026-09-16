-- ---------------------------------------------------------------------------
-- 0053 — Instagram and Messenger, the channels a buyer starts.
--
-- Neither can ever be written to first: Meta's API answers only inside the 24
-- hours after a person messages the business, there is no template and no
-- one-time notification. The registry has said so since M39, and the gate
-- refuses a cold send on both by construction. What was missing was the other
-- half — the ability to ANSWER someone who did write, which is the half this
-- product is built around: a buyer comments on a post or taps an ad, the
-- conversation lands in her inbox, and 小雅 replies inside the window.
--
-- Nothing about consent, suppression or her daily cap changes: those belong to
-- writing first, and writing first stays impossible here.
--
--   conversations.channel      += 'messenger'   ('instagram' since 0046)
--   client_channels.channel    += 'messenger'
--   channel_sources.channel    += 'messenger'
--   outbound_messages.channel  += 'instagram', 'messenger'
--
-- A buyer's id on these channels is Meta's scoped id (IGSID / PSID) — per
-- business, not a phone number, and useless to anyone else. It goes in the
-- column that already holds a WhatsApp number, because to this product it is
-- the same thing: the handle a conversation belongs to.
-- ---------------------------------------------------------------------------

alter table conversations   drop constraint if exists conversations_channel_check;
alter table conversations   add  constraint conversations_channel_check
  check (channel in ('whatsapp','wechat','instagram','messenger','rednote','webhook_test','email'));

alter table client_channels drop constraint if exists client_channels_channel_check;
alter table client_channels add  constraint client_channels_channel_check
  check (channel in ('whatsapp','wechat','instagram','messenger','rednote','webhook_test','email'));

alter table channel_sources drop constraint if exists channel_sources_channel_check;
alter table channel_sources add  constraint channel_sources_channel_check
  check (channel in ('whatsapp','wechat','instagram','messenger','rednote','webhook_test','email'));

alter table outbound_messages drop constraint if exists outbound_messages_channel_check;
alter table outbound_messages add  constraint outbound_messages_channel_check
  check (channel in ('whatsapp','email','instagram','messenger'));

-- Where a buyer's account is looked up, and what the credential belongs to.
-- `channels.kind` has allowed both since 0011; `channel_credentials` did not,
-- so `resolve_tenant('messenger', …)` could never have had a row to find.
alter table channel_credentials drop constraint if exists channel_credentials_channel_check;
alter table channel_credentials add  constraint channel_credentials_channel_check
  check (channel in ('whatsapp','wechat','instagram','messenger','rednote','telegram',
                     'webhook_test','email','web_widget'));

insert into _migrations (version, name) values (53, 'instagram_messenger')
on conflict (version) do nothing;
