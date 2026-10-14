-- ---------------------------------------------------------------------------
-- 0159 — A LANGUAGE HELD OUT OF ONE WORKSPACE (the owner, 2026-10-14).
--
-- "Arabic joins the pilot automatically once BOTH are true: the boss's products
-- carry Arabic names, and a fresh 60-turn Arabic run against the REAL product
-- set comes back with nothing gendered sent, nothing held silent, and no split
-- against English or Chinese. If it fails, Arabic stays out."
--
-- A language's release is the product's (DISCLOSURE_NATIVE_REVIEW): signed
-- for every workspace at once. Staying out of ONE workspace needs its own
-- word: `languages_held`, the languages this workspace does not answer alone
-- even though they are signed. A buyer writing in one is handed to a person
-- under its own reason (`language_held`) and hears the ordinary hand-off
-- sentence. Set and cleared only by the operator (tools/language-hold.mjs);
-- empty for every workspace, so nothing changes until it is used.
-- ---------------------------------------------------------------------------

alter table businesses
  add column if not exists languages_held text[] not null default '{}';

alter table businesses drop constraint if exists businesses_languages_held_check;
alter table businesses add constraint businesses_languages_held_check
  check (languages_held <@ array['en','zh','ar','es','fr','pt','de','tr','ru']::text[]);

comment on column businesses.languages_held is
  'Languages this workspace does not answer alone yet, though signed for the product: a buyer writing in one goes to a person (0159). The operator''s: tools/language-hold.mjs.';

alter table conversation_signals drop constraint if exists conversation_signals_kind_check;
alter table conversation_signals add constraint conversation_signals_kind_check
  check (kind in (
    'human_requested','complaint','repeated_ambiguity',
    'low_confidence_image','high_value','customization_requested',
    'logistics_discussed','moq_accepted','price_acknowledged',
    'audio_unheard','media_unreadable','unlisted_number','email_reply','email_unconfirmed',
    'assistant_stopped','ops_silenced','deletion_requested','not_answered','price_to_owner',
    'allowance_used','stock_asked','billing_lapsed','plan_limit','provider_billing','opted_out',
    'language_not_reviewed','maybe_confirmation','address_unwritten','language_held'));

alter table escalation_events drop constraint if exists escalation_events_trigger_reason_check;
alter table escalation_events add constraint escalation_events_trigger_reason_check
  check (trigger_reason in (
    'high_value','unclear_product','customization','complex_negotiation',
    'repeated_ambiguity','client_request','logistics_payment','manual',
    'low_confidence_image','audio_unheard','media_unreadable','unlisted_number','email_reply','email_unconfirmed',
    'assistant_stopped','ops_silenced','deletion_requested','not_answered','price_to_owner',
    'allowance_used','stock_asked','billing_lapsed','plan_limit','provider_billing','opted_out',
    'language_not_reviewed','maybe_confirmation','address_unwritten','language_held'));

insert into _migrations (version, name) values (159, 'language_held')
  on conflict (version) do nothing;
