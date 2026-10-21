-- ---------------------------------------------------------------------------
-- 0198 — HAND-OFFS IN TURN (Phase 5, S3; item 21).
--
-- A workspace may share its hand-offs among its people: when the assistant hands a buyer to a person, the next one in
-- turn who is not away is given the conversation (they hold it, as if they had taken it). Off by default; the owner
-- switches it on and says who is in turn and who is away, on the team page.
--
--   · businesses.rotation_on       — the switch;
--   · people.in_rotation           — in turn (never an accountant: the books' reader answers no buyer);
--   · people.away_until            — away until then (skipped while it is in the future);
--   · people.rotation_last_at      — when they were last given one: the next is whoever waited longest, so the turn is
--                                    fair and a person back from away is not given a burst.
--
-- The owner's word wins: a conversation already held is never taken from anyone, and one handed on after it was given
-- stays where it was handed. A hand-off that a deletion request made is never given to anyone: it is the owner's.
-- No new table: the columns join rows already classified for erasure and row security.
-- ---------------------------------------------------------------------------

alter table businesses add column if not exists rotation_on boolean not null default false;
alter table people add column if not exists in_rotation boolean not null default false;
alter table people add column if not exists away_until timestamptz;
alter table people add column if not exists rotation_last_at timestamptz;

alter table people drop constraint if exists people_rotation_not_accountant;
alter table people add constraint people_rotation_not_accountant check (not (in_rotation and kind = 'accountant'));

insert into _migrations (version, name) values (198, 'rotation')
  on conflict (version) do nothing;
