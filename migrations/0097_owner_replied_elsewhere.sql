-- 0097 — a reply the owner typed in Instagram's or Messenger's own app (CH3,
-- the onboarding plan's phase 4).
--
-- Meta sends every message the business's account SENDS back as an "echo".
-- Nomi's own come back too and are ignored; one the owner typed in Meta's app
-- is recorded on the transcript as the owner's, the conversation passes to the
-- owner, and any reply waiting for approval is SUPERSEDED: approving it later
-- would answer the customer twice. Nothing closed a waiting draft until now —
-- a later turn added another beside it.
--
--   · drafts.status gains 'superseded' (0009's list, copied from the live
--     constraint, plus one), with `decided_at`; the conversation's
--     `owner_replied_elsewhere` event says who and why.

alter table drafts drop constraint if exists drafts_status_check;
alter table drafts add constraint drafts_status_check
  check (status in ('pending', 'approved', 'edited', 'rejected', 'expired', 'superseded'));

insert into _migrations (version, name) values (97, 'owner_replied_elsewhere')
on conflict (version) do nothing;
