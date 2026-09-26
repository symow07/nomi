-- 0072 · The owner's words survive a refusal (CC-24, 2026-09-27).
--
-- Editing a draft started from an empty box, and when the send was refused —
-- the buyer's window shut, the assistant stopped, sending paused — the page
-- redirected with a notice and the text the owner had typed was gone. The same
-- was true of the owner's own reply box. A refusal is a moment the owner has
-- to come back to, so the words wait for them where they were typed.
--
--   drafts.owner_edit / _at — the owner's edit of THIS draft, kept when its
--     send was refused; the edit box opens with it (else with the draft).
--   conversations.owner_unsent_reply / _at — the owner's own reply, kept when
--     it was refused before it could be queued; cleared when a reply goes.
--
-- Nothing here is sent by anyone: the owner presses send again.

alter table drafts
  add column if not exists owner_edit text,
  add column if not exists owner_edit_at timestamptz;

alter table conversations
  add column if not exists owner_unsent_reply text,
  add column if not exists owner_unsent_reply_at timestamptz;

comment on column drafts.owner_edit is
  'CC-24 — the owner''s edit of this draft, kept when its send was refused. Never sent by itself.';
comment on column conversations.owner_unsent_reply is
  'CC-24 — the owner''s own reply, kept when it was refused before it could be queued; cleared when a reply goes.';

insert into _migrations (version, name) values (72, 'kept_words')
on conflict (version) do nothing;
