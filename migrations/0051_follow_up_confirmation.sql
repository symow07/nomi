-- ---------------------------------------------------------------------------
-- 0051 — a follow-up waits for a person when a reply could not be seen.
--
-- C4.b stops a sequence the moment the buyer replies — but only a reply the
-- product RECORDS (C4.c, the inbound webhook). Since C6 her mail leaves through
-- her own Gmail or Outlook, and a buyer's answer lands in that mailbox, which
-- this product deliberately does not read. So "he has not written since he was
-- enrolled" became unknowable, and a sequence would have kept writing to a man
-- who had already answered: the one thing C4.b says a sequence must never do.
--
-- Where replies cannot be seen, every follow-up (never the first mail — nobody
-- can have answered a mail that has not gone) now waits for a person to say
-- "he has not answered; send it". Nobody saying so for a week stops it. That is
-- draft-first applied to a schedule, and it asks for nothing that reads her
-- mailbox.
--
--   confirmed_position           the step a person released, and
--   confirmed_by                 who — with their name, like every decision
--   awaiting_confirmation_since  when it started waiting, for the week's limit
--   stop_reason += 'unconfirmed' nobody confirmed it in time
-- ---------------------------------------------------------------------------

alter table sequence_enrollments add column if not exists confirmed_position integer;
alter table sequence_enrollments add column if not exists confirmed_by text;
alter table sequence_enrollments add column if not exists awaiting_confirmation_since timestamptz;

alter table sequence_enrollments drop constraint if exists sequence_enrollments_stop_reason_check;
alter table sequence_enrollments add constraint sequence_enrollments_stop_reason_check
  check (stop_reason in (
    'replied', 'unsubscribed', 'bounced', 'complained', 'handed_off',
    'previous_not_sent', 'no_consent', 'outreach_not_enabled',
    'cap', 'domain', 'unreachable', 'unconfirmed', 'stopped_by_owner', 'sequence_archived'
  ));

insert into _migrations (version, name) values (51, 'follow_up_confirmation')
on conflict (version) do nothing;
