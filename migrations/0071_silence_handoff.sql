-- 0071 · The emergency silence hides nobody (2026-09-27).
--
-- The ops kill switch (0014 `ops_flags.global_silence`) stopped the assistant
-- speaking, and until now it did only that: a buyer who wrote during it got no
-- draft and no handoff, so the conversation stayed the assistant's and never
-- reached "Needs you". An emergency control is used exactly when things are
-- going wrong — the worst moment for a waiting buyer to be invisible.
--
-- It now behaves as the owner's Stop does (0070): each message is recorded
-- and the conversation handed to a person. The handoff names its own reason —
-- not the owner's Stop, which the owner did not press.

alter table conversation_signals drop constraint if exists conversation_signals_kind_check;
alter table conversation_signals add constraint conversation_signals_kind_check
  check (kind in (
    'human_requested','complaint','repeated_ambiguity',
    'low_confidence_image','high_value','customization_requested',
    'logistics_discussed','moq_accepted','price_acknowledged',
    'audio_unheard','media_unreadable','unlisted_number','email_reply',
    'assistant_stopped','ops_silenced'));

alter table escalation_events drop constraint if exists escalation_events_trigger_reason_check;
alter table escalation_events add constraint escalation_events_trigger_reason_check
  check (trigger_reason in (
    'high_value','unclear_product','customization','complex_negotiation',
    'repeated_ambiguity','client_request','logistics_payment','manual',
    'low_confidence_image','audio_unheard','media_unreadable','unlisted_number','email_reply',
    'assistant_stopped','ops_silenced'));

insert into _migrations (version, name) values (71, 'silence_handoff')
on conflict (version) do nothing;
