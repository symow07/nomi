-- ---------------------------------------------------------------------------
-- 0023 — let the audit trail name the refusal it actually recorded.
--
-- WHY THIS IS REQUIRED. `channel_audit.action` is a CHECK-constrained
-- vocabulary, and the only refusal verb in it is `blocked_not_allowlisted`
-- (added in 0021). `channelStore.auditBlocked` therefore wrote that verb for
-- EVERY reason it was handed — including `not_activated`, which is a different
-- event with a different fix. The true reason survived only inside `detail`,
-- so anything reading the trail by action read a falsehood.
--
-- Two verbs replace the guesswork, split by WHO refused and WHERE:
--
--   send_refused        gateOutbound refused a queued message at send time.
--                       detail.reason carries the GateRefusal verbatim —
--                       handed_off / paused / window_closed / not_activated /
--                       not_allowlisted / daily_ceiling — plus
--                       window_needs_owner, the in-window case that needs a
--                       template nobody has approved yet.
--   activation_refused  activationPreconditions refused to turn messaging ON.
--                       A different moment, a different fix, its own verb.
--
-- The allowlist is enforced AT SEND TIME, so an allowlist block is a
-- send_refused with reason='not_allowlisted' — not a third verb. That is the
-- honest shape: one gate, one verb, the reason in the payload.
--
-- `blocked_not_allowlisted` is KEPT so rows already written stay valid. It is
-- no longer produced; nothing reads it as current.
--
-- This is the whole schema change in M22. No table, no column, no index: the
-- refusal evidence the owner needs is already in outbound_messages.status /
-- .last_error and outbound_transitions. Additive and forward-only (ADR-0007):
-- an older build runs unchanged against this constraint.
-- ---------------------------------------------------------------------------

alter table channel_audit drop constraint if exists channel_audit_action_check;
alter table channel_audit add constraint channel_audit_action_check
  check (action in ('connect','reconnect','disconnect','test','rotate_credential',
                    'set_owner_phone','update_profile',
                    'activate','deactivate','blocked_not_allowlisted',
                    'allowlist_add','allowlist_archive',
                    'send_refused','activation_refused'));

insert into _migrations (version, name) values (23, '0023_refusal_audit_vocabulary')
  on conflict (version) do nothing;
