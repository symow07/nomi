-- 0067 — a draft the disclosure went out instead of is not sendable as it is.
--
-- WHY A COLUMN AND NOT AN EVENT. When a buyer asks what he is talking to and
-- the reply twice fails to say, an AUTO-mode turn sends the AI disclosure so he
-- is not met with silence, and keeps the reply she wrote as a draft for the
-- owner. That draft is the text that FAILED to answer him — and the buyer has
-- since had a different message. Approving it unchanged would send an evasion
-- as a follow-up to the very disclosure that replaced it.
--
-- The approval path has to be able to refuse it, and the approval path reads
-- `drafts`. An event would put the fact somewhere the one send gate does not
-- look, which is how a rule becomes advisory.
--
-- The owner is not blocked, only slowed by one step: 改 (edit) sends her own
-- words and clears the draft as it always has, 不回 skips it, 收回 pulls the
-- capability back. Only 发送 — send this exact text — is refused.
--
-- FALSE for every existing row, which is correct: no draft written before this
-- migration was ever replaced by a disclosure, because none was sent.

alter table drafts
  add column if not exists replaced_by_disclosure boolean not null default false;

comment on column drafts.replaced_by_disclosure is
  'True when an AI disclosure was sent to the buyer in place of this reply (the buyer asked what he was talking to and it did not say). Sending this text unchanged is refused; editing it is not.';

insert into _migrations (version, name) values (67, 'draft_replaced_by_disclosure')
on conflict (version) do nothing;
