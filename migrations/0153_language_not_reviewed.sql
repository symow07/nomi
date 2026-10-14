-- ---------------------------------------------------------------------------
-- 0153 — Phase 4 gate, blocker 1 (the owner, 2026-10-14): A BUYER WHOSE
-- LANGUAGE HAS NO SIGNED DISCLOSURE RECEIVES NO AUTOMATED MESSAGE AT ALL — THE
-- MESSAGE GOES TO A PERSON INSTEAD.
--
-- Until now a Spanish, French or Portuguese buyer's reply waited as a draft:
-- nothing went alone, but the gate said "drafts", and the owner asked what
-- goes out if such a buyer writes during the pilot. From here, a buyer's
-- message in a language whose disclosure no native reader signed (es, fr, pt,
-- and every language with no sentence at all) hands the conversation to a
-- person, silently — no reply, no hand-off sentence, no stop line — under its
-- own reason, so the owner reads why. The send gate refuses anything the
-- assistant would still send alone to such a buyer (`language_not_reviewed`).
--
-- This migration only teaches the two reason lists the new word; it changes
-- no row. The lists are 0135's, with the new reason at the end.
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
    'language_not_reviewed'));

alter table escalation_events drop constraint if exists escalation_events_trigger_reason_check;
alter table escalation_events add constraint escalation_events_trigger_reason_check
  check (trigger_reason in (
    'high_value','unclear_product','customization','complex_negotiation',
    'repeated_ambiguity','client_request','logistics_payment','manual',
    'low_confidence_image','audio_unheard','media_unreadable','unlisted_number','email_reply','email_unconfirmed',
    'assistant_stopped','ops_silenced','deletion_requested','not_answered','price_to_owner',
    'allowance_used','stock_asked','billing_lapsed','plan_limit','provider_billing','opted_out',
    'language_not_reviewed'));

insert into _migrations (version, name) values (153, 'language_not_reviewed')
  on conflict (version) do nothing;
