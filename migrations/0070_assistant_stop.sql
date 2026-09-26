-- 0070 · The owner's Stop, on every channel (2026-09-27).
--
-- Until now the only Stop on My business was WhatsApp's activation switch:
-- the send gate reads a `channels` row for WhatsApp alone and treats
-- Instagram, Messenger and e-mail as live once connected (db/channels.ts,
-- C4.a). An owner could not stop the assistant on those three at all, and a
-- reply already queued there went out whatever the owner pressed.
--
-- The ops kill switch (0014 `ops_flags.global_silence`) could not be reused:
-- the application role may only READ that table, by design — a compromised
-- app must be able neither to silence a business nor to lift a silence ops
-- set. So the owner's decision gets its own place, on the business's own
-- row, and the two never overwrite each other.
--
--   assistant_stopped_at / _by — set by the owner's Stop, cleared by
--   Start. Read at SEND time by the gate (a queued reply is refused, not sent
--   late) and by the worker before any turn (no model call, no draft; the
--   conversation is handed to a person so a waiting buyer stays on
--   "Needs you").
--
-- The handoff a stopped assistant makes carries its own reason, and every
-- Stop and Start is written to the channel audit, as activation is.

alter table businesses
  add column if not exists assistant_stopped_at timestamptz,
  add column if not exists assistant_stopped_by text;

comment on column businesses.assistant_stopped_at is
  'The owner stopped the assistant on every channel at this moment; null = answering. Binds the assistant''s messages and scheduled follow-ups at send time, never the owner''s own replies.';
comment on column businesses.assistant_stopped_by is
  'Who pressed Stop: a people.id, as channels.activated_by records who started WhatsApp.';

alter table conversation_signals drop constraint if exists conversation_signals_kind_check;
alter table conversation_signals add constraint conversation_signals_kind_check
  check (kind in (
    'human_requested','complaint','repeated_ambiguity',
    'low_confidence_image','high_value','customization_requested',
    'logistics_discussed','moq_accepted','price_acknowledged',
    'audio_unheard','media_unreadable','unlisted_number','email_reply',
    'assistant_stopped'));

alter table escalation_events drop constraint if exists escalation_events_trigger_reason_check;
alter table escalation_events add constraint escalation_events_trigger_reason_check
  check (trigger_reason in (
    'high_value','unclear_product','customization','complex_negotiation',
    'repeated_ambiguity','client_request','logistics_payment','manual',
    'low_confidence_image','audio_unheard','media_unreadable','unlisted_number','email_reply',
    'assistant_stopped'));

alter table channel_audit drop constraint if exists channel_audit_action_check;
alter table channel_audit add constraint channel_audit_action_check
  check (action in ('connect','reconnect','disconnect','test','rotate_credential',
                    'set_owner_phone','update_profile','activate','deactivate',
                    'blocked_not_allowlisted','allowlist_add','allowlist_archive',
                    'send_refused','activation_refused','product_edited',
                    'price_rules_set','transcript_corrected',
                    'assistant_added','assistant_changed','assistant_archived',
                    'export_data','deletion_requested','deletion_withdrawn',
                    'assistant_stop','assistant_start'));

insert into _migrations (version, name) values (70, 'assistant_stop')
on conflict (version) do nothing;
