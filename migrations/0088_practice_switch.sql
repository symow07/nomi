-- ---------------------------------------------------------------------------
-- 0088 — THE PLATFORM'S SWITCH FOR PRACTICE (P5; docs/PRACTICE.md).
--
-- Every practice message is a live model turn, charged to the workspace. The
-- operator needs one switch that stops Practice taking messages — everywhere
-- (a row with no business) or for one workspace — without a deploy, the same
-- way `global_silence` stops sending. It is an `ops_flags` row like the others:
-- written by the operator as the table owner, read by the app, never written
-- by it (0014). A flag this build does not know is ignored by the kill-switch
-- reader, so the send path is unchanged.
--
--   insert into ops_flags (business_id, flag, reason, set_by)
--   values (null, 'practice_off', 'why', 'who');   -- set cleared_at = now() to lift it
-- ---------------------------------------------------------------------------

alter table ops_flags drop constraint if exists ops_flags_flag_check;
alter table ops_flags add constraint ops_flags_flag_check
  check (flag in ('global_silence', 'force_draft', 'silence_capability', 'practice_off'));

alter table ops_flags drop constraint if exists ops_flags_check;
alter table ops_flags add constraint ops_flags_check
  check (flag in ('global_silence', 'practice_off') or capability is not null);

insert into _migrations (version, name) values (88, 'practice_switch')
on conflict (version) do nothing;
