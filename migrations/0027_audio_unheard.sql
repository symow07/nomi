-- ---------------------------------------------------------------------------
-- 0027 — M34: she can hear, and when she cannot, she says so.
--
-- WHAT WAS WRONG. The webhook parser has recognised voice notes since M3 and
-- captured their media id — and nothing downstream ever looked. A buyer's
-- voice note arrived as empty text, and she answered as though they had said
-- nothing: a confident reply to a question she invented. In Gulf and Chinese
-- B2B WhatsApp, voice notes are frequently the PRIMARY medium.
--
-- The messages table needed nothing: `input_type` has allowed 'voice' and
-- 'voice_transcribed' since the baseline, and `transcription` /
-- `detected_language` / `audio_url` have been there all along, waiting.
--
-- WHAT THIS ADDS — two vocabulary entries, both CHECK-constrained:
--
--   conversation_signals.kind += 'audio_unheard'
--     The fail-closed half. A voice note that cannot be transcribed — no
--     transcriber configured, media expired, provider refused — is recorded as
--     a PROBLEM signal, exactly like 'low_confidence_image': the conversation
--     is flagged for the owner, she is told what/why/what-to-do, and NO reply
--     is drafted. Refused, never treated as silence.
--
--   channel_audit.action += 'transcript_corrected'
--     The owner reads what was heard beside the audio and may correct it. A
--     correction SUPERSEDES: the message row carries her words, and the
--     audit row carries the before and after — so the original machine
--     transcript survives (archive, never erase) and a correction reads as a
--     correction, not a silent overwrite. Same shape as product_edited (0025).
--
-- Additive and forward-only (ADR-0007): existing rows stay valid, nothing is
-- dropped, and an older build ignores both new values entirely.
-- ---------------------------------------------------------------------------

alter table conversation_signals drop constraint if exists conversation_signals_kind_check;
alter table conversation_signals add constraint conversation_signals_kind_check
  check (kind in (
    'human_requested','complaint','repeated_ambiguity',
    'low_confidence_image','high_value','customization_requested',
    'logistics_discussed','moq_accepted','price_acknowledged',
    'audio_unheard'));

-- A problem signal escalates, and `toTriggerReason` is total over Signal — so
-- the escalation vocabulary gains the same word, or the first unheard voice
-- note fails its INSERT at exactly the moment the owner needed telling.
alter table escalation_events drop constraint if exists escalation_events_trigger_reason_check;
alter table escalation_events add constraint escalation_events_trigger_reason_check
  check (trigger_reason in (
    'high_value','unclear_product','customization','complex_negotiation',
    'repeated_ambiguity','client_request','logistics_payment','manual',
    'low_confidence_image','audio_unheard'));

alter table channel_audit drop constraint if exists channel_audit_action_check;
alter table channel_audit add constraint channel_audit_action_check
  check (action in ('connect','reconnect','disconnect','test','rotate_credential',
                    'set_owner_phone','update_profile',
                    'activate','deactivate','blocked_not_allowlisted',
                    'allowlist_add','allowlist_archive',
                    'send_refused','activation_refused',
                    'product_edited','price_rules_set',
                    'transcript_corrected'));

insert into _migrations (version, name) values (27, '0027_audio_unheard')
  on conflict (version) do nothing;
