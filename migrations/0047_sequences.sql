-- ---------------------------------------------------------------------------
-- 0047 — C4.b: a first e-mail and the follow-ups after it.
--
-- C4.a sent one message she typed. A salesperson does not send one message:
-- she sends a first mail, and if nothing comes back, a second a few days later,
-- and perhaps a third. That is a sequence, and it is the most dangerous thing
-- this product will ever do on its own — the only feature that keeps writing to
-- a stranger after she has stopped looking. So every table here exists to make
-- one of three things true:
--
--   1. WHAT GOES OUT IS WHAT SHE APPROVED, WORD FOR WORD.
--      `sequence_steps` holds the subject and body. A sequence is a draft until
--      the owner approves it, and from that moment its steps cannot be edited,
--      added to or reordered — by a TRIGGER, not by the page, because the page
--      is not the only thing that can issue an UPDATE. Changing an approved
--      sequence means writing a new one and approving that.
--
--   2. IT STOPS THE MOMENT IT SHOULD.
--      `sequence_enrollments.stop_reason` is the vocabulary of the stop
--      conditions in `src/core/outreach/sequence.ts`, and the CHECK below holds
--      exactly that list. A reply, a bounce, an unsubscribe, a complaint, a
--      takeover, a follow-up whose previous step never arrived, her switch
--      turned off — each is a row she can read, never an absence.
--
--   3. NO STEP IS SENT TWICE.
--      `sequence_sends` is keyed (enrollment, position). The scheduler inserts
--      the key BEFORE it queues the outbound row, in the same transaction, so a
--      retried job or two sweeps racing can queue a step at most once. It also
--      links the step to the `outbound_messages` row that carried it, which is
--      how a follow-up knows whether the mail before it actually arrived.
--
-- No new column on `outbound_messages`: the hot table stays as C4.a left it, and
-- its one writer (`enqueueOutboundRow`) is still the only thing that inserts
-- there. The link lives on this side.
--
-- Channel is 'email' only. WhatsApp cannot carry an uninvited message without an
-- approved template (M39), and a CHECK that admitted it would be a promise.
--
-- Archive, never erase (ADR-0007): no DELETE is granted on any of these, and a
-- sequence she no longer wants is archived, which stops what is running on it.
-- ---------------------------------------------------------------------------

create table if not exists sequences (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id) on delete cascade,
  name          text not null check (btrim(name) <> '' and length(name) <= 120),
  channel       text not null default 'email' check (channel in ('email')),
  created_by    text not null,
  created_at    timestamptz not null default now(),
  -- Her approval, with whose it was. Both or neither.
  approved_by   text,
  approved_at   timestamptz,
  archived_at   timestamptz,
  constraint sequences_approval_whole check ((approved_by is null) = (approved_at is null))
);
create index if not exists sequences_business on sequences (business_id, created_at desc);

create table if not exists sequence_steps (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id) on delete cascade,
  sequence_id   uuid not null references sequences(id) on delete cascade,
  position      integer not null check (position between 1 and 10),
  -- Days after the step before it was queued; for the first step, after the
  -- buyer was added. Zero means as soon as the sweep sees it.
  delay_days    integer not null check (delay_days between 0 and 60),
  subject       text not null check (btrim(subject) <> '' and length(subject) <= 200),
  body          text not null check (btrim(body) <> '' and length(body) <= 5000),
  created_at    timestamptz not null default now(),
  unique (sequence_id, position)
);

create table if not exists sequence_enrollments (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references businesses(id) on delete cascade,
  sequence_id      uuid not null references sequences(id) on delete cascade,
  channel          text not null default 'email' check (channel in ('email')),
  identity         text not null check (btrim(identity) <> ''),
  -- Set when the first step is queued; the thread every later step goes into.
  conversation_id  uuid references conversations(id),
  enrolled_by      text not null,
  enrolled_at      timestamptz not null default now(),
  next_position    integer not null default 1 check (next_position >= 1),
  next_due_at      timestamptz not null default now(),
  -- When the step now due FIRST became due. A step held back by her cap or an
  -- expired domain check waits day to day; this is what lets it stop instead
  -- of waiting forever.
  step_due_since   timestamptz not null default now(),
  stopped_at       timestamptz,
  stop_reason      text check (stop_reason in (
    'replied', 'unsubscribed', 'bounced', 'complained', 'handed_off',
    'previous_not_sent', 'no_consent', 'outreach_not_enabled',
    'cap', 'domain', 'unreachable', 'stopped_by_owner', 'sequence_archived'
  )),
  completed_at     timestamptz,
  constraint enrollment_stop_whole check ((stopped_at is null) = (stop_reason is null)),
  constraint enrollment_ends_once check (stopped_at is null or completed_at is null)
);
-- One LIVE enrolment per buyer per sequence. A buyer can be enrolled again
-- after one ends — that is a new decision, recorded as a new row.
create unique index if not exists sequence_enrollments_one_live
  on sequence_enrollments (business_id, sequence_id, channel, identity)
  where stopped_at is null and completed_at is null;
-- What the sweep reads every minute.
create index if not exists sequence_enrollments_due
  on sequence_enrollments (business_id, next_due_at)
  where stopped_at is null and completed_at is null;

create table if not exists sequence_sends (
  business_id    uuid not null references businesses(id) on delete cascade,
  enrollment_id  uuid not null references sequence_enrollments(id) on delete cascade,
  position       integer not null,
  outbound_id    uuid references outbound_messages(id),
  queued_at      timestamptz not null default now(),
  primary key (enrollment_id, position)
);
-- The send path asks, for each outbound row, whether a SCHEDULE sent it rather
-- than a person: the ops kill switch silences the one and not the other.
create index if not exists sequence_sends_outbound on sequence_sends (outbound_id);

-- ── Immutability of what she approved ─────────────────────────────────────
create or replace function sequence_steps_frozen() returns trigger
language plpgsql as $$
declare
  approved timestamptz;
begin
  -- FOR SHARE: an edit and her approval cannot both commit on the same
  -- snapshot. The approving UPDATE takes the row lock; an edit in flight either
  -- lands before it (and she approves what includes it — the approval route
  -- checks the fingerprint of the words she read) or waits and is refused.
  select s.approved_at into approved from sequences s
   where s.id = coalesce(new.sequence_id, old.sequence_id)
   for share;
  if approved is not null then
    raise exception 'sequence % is approved; its steps cannot change', coalesce(new.sequence_id, old.sequence_id)
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists sequence_steps_frozen on sequence_steps;
create trigger sequence_steps_frozen before insert or update on sequence_steps
  for each row execute function sequence_steps_frozen();

create or replace function sequences_approval_final() returns trigger
language plpgsql as $$
begin
  if old.approved_at is not null and (
       new.approved_at is distinct from old.approved_at
    or new.approved_by is distinct from old.approved_by
    or new.name        is distinct from old.name
    or new.channel     is distinct from old.channel) then
    raise exception 'sequence % is approved; only archiving it is possible', old.id
      using errcode = 'check_violation';
  end if;
  if old.archived_at is not null and new.archived_at is distinct from old.archived_at then
    raise exception 'sequence % is archived', old.id using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists sequences_approval_final on sequences;
create trigger sequences_approval_final before update on sequences
  for each row execute function sequences_approval_final();

-- Nobody is enrolled on something she has not approved, or has archived. The
-- scheduler relies on this rather than re-checking it: a sequence cannot be
-- un-approved (above), so an enrolment that exists is one she authorised.
create or replace function sequence_enrollments_need_approval() returns trigger
language plpgsql as $$
declare
  approved timestamptz;
  archived timestamptz;
begin
  select s.approved_at, s.archived_at into approved, archived
    from sequences s where s.id = new.sequence_id for share;
  if approved is null or archived is not null then
    raise exception 'sequence % is not approved and live; nobody can be enrolled on it', new.sequence_id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists sequence_enrollments_need_approval on sequence_enrollments;
create trigger sequence_enrollments_need_approval before insert on sequence_enrollments
  for each row execute function sequence_enrollments_need_approval();

-- ── Tenancy ────────────────────────────────────────────────────────────────
alter table sequences            enable row level security;
alter table sequence_steps       enable row level security;
alter table sequence_enrollments enable row level security;
alter table sequence_sends       enable row level security;

do $$
declare t text;
begin
  foreach t in array array['sequences','sequence_steps','sequence_enrollments','sequence_sends'] loop
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_tenant') then
      execute format(
        'create policy %I on %I for all to nomi_app
           using (business_id = current_business_id())
           with check (business_id = current_business_id())', t || '_tenant', t);
    end if;
  end loop;
end $$;

grant select, insert, update on sequences, sequence_steps, sequence_enrollments, sequence_sends to nomi_app;
revoke delete, truncate on sequences, sequence_steps, sequence_enrollments, sequence_sends from nomi_app;

insert into _migrations (version, name) values (47, 'sequences')
on conflict (version) do nothing;
