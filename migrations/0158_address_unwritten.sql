-- ---------------------------------------------------------------------------
-- 0158 — A REPLY THAT COULD NOT BE WRITTEN WITHOUT A GENDER IS A PERSON'S, AND
-- THE BUYER IS TOLD SO (rule 6; the owner, 2026-10-14: "a buyer who gets
-- nothing is not a pass").
--
-- When the writer, asked twice, both times addressed the buyer as a man or a
-- woman (Arabic; src/core/safety/address.ts), the turn was held as a draft and
-- the buyer waited in silence. Now it hands the conversation to a person under
-- its own reason (`address_unwritten`), and the buyer hears the ordinary
-- hand-off sentence, which addresses nobody.
--
-- This migration only teaches the two reason lists the new word; it changes
-- no row. The lists are 0157's, with the new reason at the end.
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
    'language_not_reviewed','maybe_confirmation','address_unwritten'));

alter table escalation_events drop constraint if exists escalation_events_trigger_reason_check;
alter table escalation_events add constraint escalation_events_trigger_reason_check
  check (trigger_reason in (
    'high_value','unclear_product','customization','complex_negotiation',
    'repeated_ambiguity','client_request','logistics_payment','manual',
    'low_confidence_image','audio_unheard','media_unreadable','unlisted_number','email_reply','email_unconfirmed',
    'assistant_stopped','ops_silenced','deletion_requested','not_answered','price_to_owner',
    'allowance_used','stock_asked','billing_lapsed','plan_limit','provider_billing','opted_out',
    'language_not_reviewed','maybe_confirmation','address_unwritten'));

insert into _migrations (version, name) values (158, 'address_unwritten')
  on conflict (version) do nothing;
