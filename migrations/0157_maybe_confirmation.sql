-- ---------------------------------------------------------------------------
-- 0157 — A YES THE LIST DID NOT KNOW GOES TO THE OWNER (the owner, 2026-10-14,
-- the language sweep's finding 1).
--
-- After a price was given, a buyer's «好的», «تمام» or "sounds great" — words
-- the fast path's list did not have — reached the writer, which quoted the
-- price again, alone. "Make the list stop being load-bearing… Fail toward me,
-- not toward a wrong reply." Such a reply now hands the conversation to the
-- owner as "this may be a confirmation" (`maybe_confirmation`): the buyer hears
-- the order's own line, and the owner confirms or answers.
--
-- This migration only teaches the two reason lists the new word; it changes
-- no row. The lists are 0153's, with the new reason at the end.
-- ---------------------------------------------------------------------------

alter table conversation_signals drop constraint if exists conversation_signals_kind_check;
alter table conversation_signals add constraint conversation_signals_kind_check
  check (kind in (
    'human_requested','complaint','repeated_ambiguity',
    'low_confidence_image','high_value','customization_requested',
    'logistics_discussed','moq_accepted','price_acknowledged',
    'audio_unheard','media_unreadable','unlisted_number','email_reply','email_unconfirmed',
    'assistant_stopped','ops_silenced','deletion_requested','not_answered','price_to_owner',
    'allowance_used','stock_asked','billing_lapsed','plan_limit','provider_billing','opted_out',
    'language_not_reviewed','maybe_confirmation'));

alter table escalation_events drop constraint if exists escalation_events_trigger_reason_check;
alter table escalation_events add constraint escalation_events_trigger_reason_check
  check (trigger_reason in (
    'high_value','unclear_product','customization','complex_negotiation',
    'repeated_ambiguity','client_request','logistics_payment','manual',
    'low_confidence_image','audio_unheard','media_unreadable','unlisted_number','email_reply','email_unconfirmed',
    'assistant_stopped','ops_silenced','deletion_requested','not_answered','price_to_owner',
    'allowance_used','stock_asked','billing_lapsed','plan_limit','provider_billing','opted_out',
    'language_not_reviewed','maybe_confirmation'));

insert into _migrations (version, name) values (157, 'maybe_confirmation')
  on conflict (version) do nothing;
