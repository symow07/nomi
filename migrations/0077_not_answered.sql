-- 0077 · A message nobody could read is answered by a person (2026-09-28).
--
-- "Wants a person" now has two layers: a tightened word list for the
-- unambiguous requests, and the analyser's own answer for everything else
-- ("is this buyer asking to speak to a person?"). When that answer cannot be
-- read — or the turn fails until the queue gives up on it — nobody knows what
-- the buyer asked, so the conversation goes to a person under its own reason,
-- 'not_answered': ambiguous means hand off.
--
-- Both CHECK lists are 0075's, copied exactly, with the one new word.

alter table conversation_signals drop constraint if exists conversation_signals_kind_check;
alter table conversation_signals add constraint conversation_signals_kind_check
  check (kind in (
    'human_requested','complaint','repeated_ambiguity',
    'low_confidence_image','high_value','customization_requested',
    'logistics_discussed','moq_accepted','price_acknowledged',
    'audio_unheard','media_unreadable','unlisted_number','email_reply',
    'assistant_stopped','ops_silenced','deletion_requested','not_answered'));

alter table escalation_events drop constraint if exists escalation_events_trigger_reason_check;
alter table escalation_events add constraint escalation_events_trigger_reason_check
  check (trigger_reason in (
    'high_value','unclear_product','customization','complex_negotiation',
    'repeated_ambiguity','client_request','logistics_payment','manual',
    'low_confidence_image','audio_unheard','media_unreadable','unlisted_number','email_reply',
    'assistant_stopped','ops_silenced','deletion_requested','not_answered'));

insert into _migrations (version, name) values (77, 'not_answered')
on conflict (version) do nothing;
