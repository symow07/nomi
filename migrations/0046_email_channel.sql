-- ---------------------------------------------------------------------------
-- 0046 — C4.a: an email can exist.
--
-- Everything about e-mail has been built for four milestones — consent (M38),
-- the capability registry (M39), the sending domain (M40.1), bounces and
-- complaints (M40.2), the outreach gate (M42) — and none of it could ever run,
-- because the database could not hold an e-mail conversation:
--
--   conversations.channel   CHECK (whatsapp|wechat|instagram|rednote|webhook_test)
--   client_channels.channel CHECK (same five)
--
-- An address is not one of those, so `ensureConversation` could not insert a
-- row, `enqueueOutboundRow` resolved recipients from `client_channels` where
-- channel = 'whatsapp', and the outbound row itself carried no channel at all.
--
-- WHAT THIS ADDS, and nothing more:
--
--   conversations.channel  += 'email'        a thread with a buyer by mail
--   client_channels.channel += 'email'       his address, as a channel identity
--   channel_sources.channel += 'email'       for symmetry: the three lists were
--                                            written as one and drift apart
--                                            the moment they stop being equal
--
--   outbound_messages.channel  text not null default 'whatsapp'
--     WHICH TRANSPORT CARRIES THIS ROW. Defaulted, so every row that exists
--     today keeps exactly the meaning it has, and the WhatsApp path cannot
--     change behaviour by being migrated. It is what the worker reads to pick
--     an adapter, and what the outreach ceiling counts by.
--
--   outbound_messages.subject  text
--     AN E-MAIL HAS A SUBJECT AND NOTHING IN THIS PRODUCT CARRIED ONE. Null on
--     every WhatsApp row, where the concept does not exist. She writes it with
--     the body and approves both together — decided 2026-09-12, over deriving
--     it from the first line (the subject becomes a side effect of how she
--     phrased her opening) and over one subject per sequence (every follow-up
--     then reads as a resend).
--
--   outbound_messages.origin += 'outreach'
--     A message that STARTS a conversation, as opposed to 'employee' (her
--     employee answering a buyer) and 'owner' (the owner typing herself). It is
--     a third kind of authorship and the send gate treats it as one: only this
--     origin faces the outreach gate, and only this origin counts against her
--     daily outreach cap.
--
--   outreach_settings.daily_cap integer
--     HER CEILING, IN HER OWN ROW. `OutreachInput.ceilingReached` has been a
--     required field since M42 with nothing to feed it; this is what feeds it.
--     Null means she has stated no cap of her own and the code's default
--     applies. Insert-only like the rest of that table: a cap she changed is a
--     new row, and the refusal from March is still explained by the row that
--     was current then.
--
-- NO `outreach_log`. The roadmap listed one since M38 and postponed it twice,
-- correctly, because nothing wrote it. It is not needed: what went out is
-- `outbound_messages`, and counting the rows we already write leaves one record
-- of the day rather than two that can disagree. A second table would be the
-- `message_fragments` mistake with a different name.
--
-- Additive and forward-only (ADR-0007): every existing row stays valid, and
-- nothing reads the new columns until the code that writes them lands with it.
-- ---------------------------------------------------------------------------

alter table conversations   drop constraint if exists conversations_channel_check;
alter table conversations   add  constraint conversations_channel_check
  check (channel in ('whatsapp','wechat','instagram','rednote','webhook_test','email'));

alter table client_channels drop constraint if exists client_channels_channel_check;
alter table client_channels add  constraint client_channels_channel_check
  check (channel in ('whatsapp','wechat','instagram','rednote','webhook_test','email'));

alter table channel_sources drop constraint if exists channel_sources_channel_check;
alter table channel_sources add  constraint channel_sources_channel_check
  check (channel in ('whatsapp','wechat','instagram','rednote','webhook_test','email'));

alter table outbound_messages add column if not exists channel text not null default 'whatsapp';
alter table outbound_messages drop constraint if exists outbound_messages_channel_check;
alter table outbound_messages add  constraint outbound_messages_channel_check
  check (channel in ('whatsapp','email'));

alter table outbound_messages add column if not exists subject text;

alter table outbound_messages drop constraint if exists outbound_messages_origin_check;
alter table outbound_messages add  constraint outbound_messages_origin_check
  check (origin in ('employee','owner','outreach'));

-- The daily count the ceiling reads: her outreach, on this channel, today.
create index if not exists idx_outbound_outreach_today
  on outbound_messages (business_id, channel, sent_at)
  where origin = 'outreach';

alter table outreach_settings add column if not exists daily_cap integer
  check (daily_cap is null or daily_cap > 0);

insert into _migrations (version, name) values (46, 'email_channel')
on conflict (version) do nothing;
