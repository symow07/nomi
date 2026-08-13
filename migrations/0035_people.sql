-- 0035 — M47: more than one human.
--
-- The access code was a single owner. A real Yiwu factory is a boss and two or
-- three sales staff, and `conversations.assigned_to` could say "a human holds
-- this" but not WHICH human — so nobody could see who was on what, and a
-- takeover could not be routed to anyone.
--
-- THIS EXTENDS THE EXISTING OWNERSHIP MODEL RATHER THAN REPLACING IT.
-- `assigned_to` already documented its own future: "ANY other non-null agent
-- (owner sentinel or a future human id) = OWNER_CONTROLLED". This table is
-- where that id comes from. No column is renamed, no sentinel is retired, and
-- `ownershipOf` is untouched — 'owner' and 'unclaimed' still mean exactly what
-- they meant when they were written, which is what makes every historical row
-- still readable.

create table if not exists people (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  name         text not null check (btrim(name) <> ''),
  -- HMAC of the code she hands them, keyed by the installation's credential
  -- key. The code itself is shown to her ONCE, at creation, and is not
  -- recoverable — a code this table could give back is a code this table could
  -- leak. Rotating CREDENTIAL_KEY invalidates every staff code, which is a
  -- documented consequence and the reason the OWNER's own code stays in env:
  -- her way in must not depend on a row.
  code_hash    text,
  -- Exactly one owner per business. The distinction exists because four things
  -- belong to the person whose business it is (core/conversation/people.ts);
  -- there are no other roles and no permissions matrix.
  is_owner     boolean not null default false,
  created_at   timestamptz not null default now(),
  -- Archive, never erase: a conversation she held last March still names her.
  archived_at  timestamptz
);

create unique index if not exists people_one_owner
  on people (business_id) where is_owner and archived_at is null;

create index if not exists people_live
  on people (business_id) where archived_at is null;

-- A code identifies exactly one person across the installation. Two people
-- sharing a code would make "who holds this" unanswerable at the moment it
-- matters most.
create unique index if not exists people_code_unique
  on people (code_hash) where code_hash is not null and archived_at is null;

alter table people enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'people' and policyname = 'people_tenant') then
    create policy people_tenant on people
      for all to nomi_app
      using (business_id = current_business_id())
      with check (business_id = current_business_id());
  end if;
end $$;

-- Every existing business gets its owner row, so "who holds this" has an
-- answer for conversations that were assigned before this migration ran. Her
-- login is unchanged and still comes from the environment; this row is her
-- NAME, not her way in.
insert into people (business_id, name, is_owner)
select b.id, coalesce(nullif(btrim(b.name), ''), 'Owner'), true
  from businesses b
 where not exists (
   select 1 from people p where p.business_id = b.id and p.is_owner and p.archived_at is null
 );

insert into _migrations (version, name)
values (35, 'people')
on conflict (version) do nothing;
