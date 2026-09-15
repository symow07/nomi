-- ---------------------------------------------------------------------------
-- 0039 — G2c: something the buyer sent that she cannot read reaches a person.
--
-- WHAT WAS WRONG. The webhook parser sorts every WhatsApp message into text,
-- image, audio — or 'unsupported', which carried no text at all. A document,
-- a video, a location, a sticker, a reaction: each reached the turn pipeline
-- as an empty string, and she replied to it. An emoji reaction got an answer
-- to nothing; a PDF request for quotation got a confident reply to a question
-- she never read, and the owner was never shown that a file had arrived.
--
-- WHAT THIS ADDS — one vocabulary entry, in the two places it is constrained:
--
--   conversation_signals.kind += 'media_unreadable'
--     A PROBLEM signal, the same shape as 'audio_unheard' and
--     'low_confidence_image': the buyer sent something, the machine cannot
--     read it, so she does not answer and the conversation goes to a person.
--     What arrived (document, video, location…) travels in the payload so the
--     owner is told WHAT to go and look at, not merely that something failed.
--
--   escalation_events.trigger_reason += 'media_unreadable'
--     `toTriggerReason` is total over Signal (src/core/scoring/signals.ts),
--     so the escalation vocabulary gains the same word — or the first PDF a
--     buyer sends fails its INSERT at exactly the moment the owner needed
--     telling. 0027 made this same pairing for 'audio_unheard'.
--
-- Reactions and stickers are NOT a signal. They are recorded and ignored:
-- nothing was asked, and there is nothing for anyone to answer.
--
-- The messages table needs nothing: `input_type` has allowed 'unknown' since
-- the baseline, and `ai_analysis` carries what kind of thing arrived.
--
-- Additive and forward-only (ADR-0007): existing rows stay valid, nothing is
-- dropped, and an older build ignores the new value entirely.
-- ---------------------------------------------------------------------------

alter table conversation_signals drop constraint if exists conversation_signals_kind_check;
alter table conversation_signals add constraint conversation_signals_kind_check
  check (kind in (
    'human_requested','complaint','repeated_ambiguity',
    'low_confidence_image','high_value','customization_requested',
    'logistics_discussed','moq_accepted','price_acknowledged',
    'audio_unheard','media_unreadable'));

alter table escalation_events drop constraint if exists escalation_events_trigger_reason_check;
alter table escalation_events add constraint escalation_events_trigger_reason_check
  check (trigger_reason in (
    'high_value','unclear_product','customization','complex_negotiation',
    'repeated_ambiguity','client_request','logistics_payment','manual',
    'low_confidence_image','audio_unheard','media_unreadable'));

insert into _migrations (version, name) values (39, 'media_unreadable')
on conflict (version) do nothing;
