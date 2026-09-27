-- 0075 · A buyer who asks for their data to be deleted is answered by a person (2026-09-27).
--
-- The owner's decision: when a buyer asks in chat for their data to be deleted,
-- the conversation goes to a person and the assistant says NOTHING — no reply,
-- no receipt, no acknowledgment — and a human replies. Only the business can
-- record the request (CC-02, 0073) and only Nomi's operator carries it out, so
-- nothing the assistant could say would be a promise it can keep.
--
-- The hand-off names its own reason, 'deletion_requested', so the owner sees
-- why the conversation came to them and what to do about it.

alter table conversation_signals drop constraint if exists conversation_signals_kind_check;
alter table conversation_signals add constraint conversation_signals_kind_check
  check (kind in (
    'human_requested','complaint','repeated_ambiguity',
    'low_confidence_image','high_value','customization_requested',
    'logistics_discussed','moq_accepted','price_acknowledged',
    'audio_unheard','media_unreadable','unlisted_number','email_reply',
    'assistant_stopped','ops_silenced','deletion_requested'));

alter table escalation_events drop constraint if exists escalation_events_trigger_reason_check;
alter table escalation_events add constraint escalation_events_trigger_reason_check
  check (trigger_reason in (
    'high_value','unclear_product','customization','complex_negotiation',
    'repeated_ambiguity','client_request','logistics_payment','manual',
    'low_confidence_image','audio_unheard','media_unreadable','unlisted_number','email_reply',
    'assistant_stopped','ops_silenced','deletion_requested'));

insert into _migrations (version, name) values (75, 'deletion_handoff')
on conflict (version) do nothing;
