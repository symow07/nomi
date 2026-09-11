-- ---------------------------------------------------------------------------
-- 0042 — G10: day-one WhatsApp. The reply window is the BUYER's, and a number
-- she has not agreed to reach is shown to her rather than answered.
--
-- WHAT WAS WRONG, 1 — ONE WINDOW FOR EVERY BUYER. WhatsApp allows a free-form
-- reply for 24 hours after THAT buyer last wrote. The send path read
-- `channels.last_inbound_at`, which any buyer's message moves: with two
-- buyers, one silent for a day, his window never closed as far as the gate
-- could tell, and Meta rejects the late reply the gate let through. Draft-
-- first makes late approvals the normal case, so this was the day-one bug.
--
-- WHAT THIS ADDS, 1:
--
--   client_channels.last_inbound_at — when this buyer, on this channel, last
--     wrote. The window is per user on WhatsApp, not per conversation: a
--     buyer whose order closed one conversation and who writes again in a
--     new one has reopened his window for both. `channels.last_inbound_at`
--     stays: it is the channel's health ("when did anything last arrive").
--
--   Backfilled from the webhook's own record (`channel_events`, whose
--   conversation key is 'whatsapp:<buyer>:<number>'), then from recorded
--   inbound messages. A buyer with neither stays NULL, which the window reads
--   as closed: the safe answer, and the one Meta would give.
--
-- WHAT WAS WRONG, 2 — A NUMBER NOT ON HER LIST GOT A TURN. During the pilot
-- only the numbers she allowlisted may be written to. A message from any
-- other ran a model turn and produced a draft the send gate could never let
-- out — cost, and a reply waiting for a send that cannot happen.
--
-- WHAT THIS ADDS, 2 — one vocabulary entry, in the two places it is
-- constrained (as 0039 did for 'media_unreadable'):
--
--   conversation_signals.kind += 'unlisted_number'
--   escalation_events.trigger_reason += 'unlisted_number'
--
-- Additive and forward-only (ADR-0007).
-- ---------------------------------------------------------------------------

alter table client_channels add column if not exists last_inbound_at timestamptz;

update client_channels cc
   set last_inbound_at = x.at
  from (select split_part(conversation_external_id, ':', 2) as wa_id, max(occurred_at) as at
          from channel_events
         where channel = 'whatsapp' and event_type = 'message.inbound'
           and conversation_external_id like 'whatsapp:%'
         group by 1) x
 where cc.channel = 'whatsapp' and cc.channel_user_id = x.wa_id and cc.last_inbound_at is null;

update client_channels cc
   set last_inbound_at = x.at
  from (select c.client_id, max(m.sent_at) as at
          from messages m join conversations c on c.id = m.conversation_id
         where m.direction = 'inbound'
         group by c.client_id) x
 where cc.client_id = x.client_id and cc.channel = 'whatsapp' and cc.last_inbound_at is null;

alter table conversation_signals drop constraint if exists conversation_signals_kind_check;
alter table conversation_signals add constraint conversation_signals_kind_check
  check (kind in (
    'human_requested','complaint','repeated_ambiguity',
    'low_confidence_image','high_value','customization_requested',
    'logistics_discussed','moq_accepted','price_acknowledged',
    'audio_unheard','media_unreadable','unlisted_number'));

alter table escalation_events drop constraint if exists escalation_events_trigger_reason_check;
alter table escalation_events add constraint escalation_events_trigger_reason_check
  check (trigger_reason in (
    'high_value','unclear_product','customization','complex_negotiation',
    'repeated_ambiguity','client_request','logistics_payment','manual',
    'low_confidence_image','audio_unheard','media_unreadable','unlisted_number'));

insert into _migrations (version, name) values (42, 'buyer_window_and_unlisted')
on conflict (version) do nothing;
