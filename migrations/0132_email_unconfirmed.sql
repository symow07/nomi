-- 0132 · R1 — an e-mail whose sender could not be confirmed is held for a person (docs/PRE-LAUNCH.md).
--
-- The From line of an e-mail is whatever the sender typed. A reply, or a mail in a connected inbox, counts as
-- that address's words only when the receiving server confirmed the sender (DMARC, or DKIM or SPF for the From
-- domain; src/channels/email/senderAuth.ts). Anything else is kept on the conversation, marked in the message's
-- own notes (`ai_analysis->>'sender' = 'unconfirmed'`, beside 'received' and 'about'), records no consent, is
-- answered by nobody, and hands the conversation to a person under this reason.
--
-- Additive and forward-only (ADR-0007): the two lists below are 0128's, with one reason added.

alter table conversation_signals drop constraint if exists conversation_signals_kind_check;
alter table conversation_signals add constraint conversation_signals_kind_check
  check (kind in (
    'human_requested','complaint','repeated_ambiguity',
    'low_confidence_image','high_value','customization_requested',
    'logistics_discussed','moq_accepted','price_acknowledged',
    'audio_unheard','media_unreadable','unlisted_number','email_reply','email_unconfirmed',
    'assistant_stopped','ops_silenced','deletion_requested','not_answered','price_to_owner',
    'allowance_used','stock_asked','billing_lapsed','plan_limit','provider_billing'));

alter table escalation_events drop constraint if exists escalation_events_trigger_reason_check;
alter table escalation_events add constraint escalation_events_trigger_reason_check
  check (trigger_reason in (
    'high_value','unclear_product','customization','complex_negotiation',
    'repeated_ambiguity','client_request','logistics_payment','manual',
    'low_confidence_image','audio_unheard','media_unreadable','unlisted_number','email_reply','email_unconfirmed',
    'assistant_stopped','ops_silenced','deletion_requested','not_answered','price_to_owner',
    'allowance_used','stock_asked','billing_lapsed','plan_limit','provider_billing'));

insert into _migrations (version, name) values (132, 'email_unconfirmed')
  on conflict (version) do nothing;
