-- ---------------------------------------------------------------------------
-- 0055 — A1: a factory signs itself up, and signs in as itself.
--
-- Until now there was ONE way in: an access code in the host's environment,
-- opening the one business the environment named. A second factory could not
-- exist without the operator creating its row by hand and redeploying with a
-- different PILOT_BUSINESS_ID — which also locked the first one out. That is
-- a pilot's shape, not a product's.
--
-- What this adds is small on purpose:
--
--   logins          an e-mail and a password hash, belonging to ONE person in
--                   ONE business. The e-mail is unique across the installation,
--                   so signing in never asks "which factory?".
--   signup_invites  a single-use ticket the operator hands to a factory, for
--                   installations that do not want strangers creating tenants
--                   (SIGNUP_MODE=invite). The application role cannot read or
--                   write this table at all.
--
-- THE SECURITY PROPERTY OF 0005 STANDS. The application role still cannot
-- insert into `businesses`: row-level security refuses it, and the integration
-- test that proves so is unchanged. A tenant is created by exactly one
-- function, `provision_account`, which does one fixed thing — a business, its
-- owner, and that owner's login, together or not at all — and takes nothing
-- from the caller that could name an existing tenant. It is `resolve_tenant`'s
-- pattern (0005): the questions that must be answered BEFORE a tenant is known
-- are asked through a narrow definer function, never by loosening a policy.
-- ---------------------------------------------------------------------------

create table if not exists logins (
  id                   uuid primary key default gen_random_uuid(),
  business_id          uuid not null references businesses(id) on delete cascade,
  person_id            uuid not null references people(id) on delete cascade,
  -- Stored the way it is compared: trimmed and lower-cased by the writer.
  email                text not null check (email = lower(btrim(email)) and position('@' in email) > 1),
  -- scrypt$N$r$p$salt$hash (src/security/password.ts). Never a bare digest: a
  -- row that does not say how it was made cannot be re-made stronger later.
  password_hash        text not null check (password_hash like 'scrypt$%'),
  created_at           timestamptz not null default now(),
  password_changed_at  timestamptz not null default now(),
  last_login_at        timestamptz,
  -- Guessing is slowed per LOGIN, not only per address it comes from: five
  -- wrong passwords lock this login for a quarter of an hour.
  failed_attempts      integer not null default 0,
  locked_until         timestamptz,
  -- Archive, never erase — the same rule as `people`.
  archived_at          timestamptz
);

create unique index if not exists logins_email_live
  on logins (email) where archived_at is null;
create unique index if not exists logins_person_live
  on logins (person_id) where archived_at is null;

alter table logins enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'logins' and policyname = 'logins_tenant') then
    create policy logins_tenant on logins
      for all to nomi_app
      using (business_id = current_business_id())
      with check (business_id = current_business_id());
  end if;
end $$;

grant select, insert, update on logins to nomi_app;
revoke delete, truncate on logins from nomi_app;

create table if not exists signup_invites (
  id          uuid primary key default gen_random_uuid(),
  -- Who it was made for, in the operator's own words. Never shown to anyone.
  note        text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '14 days',
  used_at     timestamptz,
  used_by     uuid references businesses(id) on delete set null
);

-- No policy and no grant: to the application role this table does not exist.
alter table signup_invites enable row level security;
revoke all on signup_invites from nomi_app;

-- ── Before a tenant is known ────────────────────────────────────────────────

-- Who is this e-mail? Returns at most one LIVE login whose person is live.
create or replace function login_lookup(p_email text)
returns table (
  login_id uuid, business_id uuid, person_id uuid, person_name text, is_owner boolean,
  password_hash text, locked_until timestamptz
)
language sql stable security definer set search_path = public as $$
  select l.id, l.business_id, p.id, p.name, p.is_owner, l.password_hash, l.locked_until
    from logins l
    join people p on p.id = l.person_id and p.archived_at is null
    join businesses b on b.id = l.business_id and b.is_active
   where l.email = lower(btrim(p_email)) and l.archived_at is null
   limit 1
$$;
revoke all on function login_lookup(text) from public;
grant execute on function login_lookup(text) to nomi_app;

-- What happened at the door. A success clears the count; the fifth failure in
-- a row locks the login for fifteen minutes and starts the count again.
create or replace function login_record(p_login_id uuid, p_ok boolean)
returns void
language sql volatile security definer set search_path = public as $$
  update logins
     set failed_attempts = case when p_ok then 0
                                when failed_attempts + 1 >= 5 then 0
                                else failed_attempts + 1 end,
         locked_until    = case when p_ok then null
                                when failed_attempts + 1 >= 5 then now() + interval '15 minutes'
                                else locked_until end,
         last_login_at   = case when p_ok then now() else last_login_at end
   where id = p_login_id
$$;
revoke all on function login_record(uuid, boolean) from public;
grant execute on function login_record(uuid, boolean) to nomi_app;

-- Whose staff code is this? The code's keyed hash is unique across the
-- installation (0035: people_code_unique), so it names its own business —
-- which is what lets a second factory's staff sign in at all.
create or replace function person_for_code(p_code_hash text)
returns table (business_id uuid, person_id uuid, person_name text, is_owner boolean)
language sql stable security definer set search_path = public as $$
  select p.business_id, p.id, p.name, p.is_owner
    from people p
    join businesses b on b.id = p.business_id and b.is_active
   where p.code_hash = p_code_hash and p.code_hash is not null and p.archived_at is null
   limit 1
$$;
revoke all on function person_for_code(text) from public;
grant execute on function person_for_code(text) to nomi_app;

-- Is this ticket still good? Answers only yes or no.
create or replace function invite_is_open(p_invite uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from signup_invites
                  where id = p_invite and used_at is null and expires_at > now())
$$;
revoke all on function invite_is_open(uuid) from public;
grant execute on function invite_is_open(uuid) to nomi_app;

-- THE one way a tenant comes to exist from the application. All or nothing:
-- a business, its owner, the owner's login — and, when a ticket is required,
-- the ticket spent in the same transaction so it cannot be spent twice.
--
-- Raises:
--   unique_violation (23505)  the e-mail already has a login
--   P0001 'invite_not_open'   the ticket is missing, used or expired
create or replace function provision_account(
  p_business_name text, p_language text, p_owner_name text,
  p_email text, p_password_hash text, p_invite uuid, p_invite_required boolean
)
returns table (business_id uuid, person_id uuid)
language plpgsql volatile security definer set search_path = public as $$
declare
  v_business uuid := gen_random_uuid();
  v_person   uuid := gen_random_uuid();
  v_lang     text := case when p_language in ('en','zh','ar') then p_language else 'en' end;
begin
  if p_invite_required then
    update signup_invites set used_at = now(), used_by = null
     where id = p_invite and used_at is null and expires_at > now();
    if not found then
      raise exception 'invite_not_open' using errcode = 'P0001';
    end if;
  end if;

  insert into businesses (id, name, timezone, default_language, owner_locale, engine)
  values (v_business, btrim(p_business_name), 'Asia/Shanghai', v_lang, v_lang, 'service');

  insert into people (id, business_id, name, is_owner)
  values (v_person, v_business, btrim(p_owner_name), true);

  insert into logins (business_id, person_id, email, password_hash)
  values (v_business, v_person, lower(btrim(p_email)), p_password_hash);

  if p_invite_required then
    update signup_invites set used_by = v_business where id = p_invite;
  end if;

  return query select v_business, v_person;
end $$;
revoke all on function provision_account(text, text, text, text, text, uuid, boolean) from public;
grant execute on function provision_account(text, text, text, text, text, uuid, boolean) to nomi_app;

-- Which factories does the clock look at? The minute's sweep (follow-ups, the
-- weekly domain check) ran for the one business the environment named. It now
-- runs for every live business THAT HAS SOMETHING FOR IT TO DO: a follow-up
-- still running, or a sending domain whose check can lapse. Not "every
-- business" — the sweep is a transaction or two per factory per minute, and an
-- installation with a thousand idle workspaces must not spend its minute, or
-- its shutdown, walking them. Ids only.
create or replace function live_business_ids()
returns table (business_id uuid)
language sql stable security definer set search_path = public as $$
  select b.id from businesses b
   where b.is_active
     and (exists (select 1 from sequence_enrollments e
                   where e.business_id = b.id and e.stopped_at is null and e.completed_at is null)
       or exists (select 1 from sending_domains s where s.business_id = b.id))
$$;
revoke all on function live_business_ids() from public;
grant execute on function live_business_ids() to nomi_app;

insert into _migrations (version, name) values (55, 'accounts')
on conflict (version) do nothing;
