-- 0133 · the business's postal address, for its marketing e-mail (docs/PRE-LAUNCH.md item 3).
--
-- The business is the sender of every first e-mail and follow-up Nomi sends for it, through its own mailbox, and
-- the law in many places asks that each carries the sender's postal address and a way to unsubscribe. The owner
-- (or the team) writes the address once, on Settings → the business profile; nobody at Nomi touches it. The
-- outbound worker puts it, with a per-recipient unsubscribe link, into the footer of each such e-mail, and REFUSES
-- to send one while it is empty (`no_postal_address`). Replies to someone who wrote first are not marketing and
-- carry neither.
--
-- Additive and forward-only (ADR-0007): an older build neither reads nor writes it.

alter table businesses
  add column if not exists postal_address text
    check (postal_address is null or length(btrim(postal_address)) between 1 and 400);

comment on column businesses.postal_address is
  '0133: the business''s postal address, put by the outbound worker into every first e-mail and follow-up; none, none sent.';

insert into _migrations (version, name) values (133, 'postal_address')
  on conflict (version) do nothing;
