-- ---------------------------------------------------------------------------
-- 0078 — a login for a workspace that exists, and a link to choose its password.
--
-- Until now a login came to exist in exactly one way: signing up, which makes a
-- NEW business (provision_workspace, 0056). A workspace made any other way —
-- the pilot's, provisioned by hand before 0055 — had no login at all, and an
-- owner whose only login was lost had nowhere to go. The only route was
-- hand-written SQL, which is what tools/provision-factory.mjs was written to
-- end.
--
-- `login_setups` is the second half of tools/add-login.mjs. The tool (admin
-- access only) attaches a login to the workspace's owner and writes one row
-- here; the owner opens the link it prints and chooses a password on the door
-- (`/login/set-password`). A password never passes through a command line,
-- a shell history or a chat.
--
-- The link is a random 32-byte token. Only its SHA-256 is stored, so the row
-- cannot give it back; it is spent once, lapses by itself, and a newer link for
-- the same login closes the older ones.
--
-- To the application role this table does not exist, like `login_codes`: it
-- may only ask whether a link is good and spend it, through two definer
-- functions. It carries `business_id` so the erasure and pruning tools, which
-- find a workspace's rows by that column, take it with the workspace.
-- ---------------------------------------------------------------------------

create table if not exists login_setups (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  login_id     uuid not null references logins(id) on delete cascade,
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  used_at      timestamptz,
  -- Which tool or person made it, for the trail. Never the token.
  made_by      text not null check (btrim(made_by) <> '')
);

create index if not exists login_setups_open on login_setups (login_id) where used_at is null;

alter table login_setups enable row level security;
revoke all on login_setups from nomi_app;

-- Is this link still good? Answers with the e-mail it sets a password for —
-- shown on the page, so the owner knows which account it is — and nothing else.
create or replace function login_setup_open(p_token_hash text)
returns table (email text)
language sql stable security definer set search_path = public as $$
  select l.email
    from login_setups s
    join logins l on l.id = s.login_id and l.archived_at is null
    join people p on p.id = l.person_id and p.archived_at is null
    join businesses b on b.id = l.business_id and b.is_active
   where s.token_hash = p_token_hash and s.used_at is null and s.expires_at > now()
   limit 1
$$;
revoke all on function login_setup_open(text) from public;
grant execute on function login_setup_open(text) to nomi_app;

-- Spend it: the password the owner chose (hashed by the application, like
-- every password), the link closed, every other open link for the login closed
-- too, and the login unlocked — the same columns a password change writes
-- (src/db/accounts.ts setPassword). Returns the e-mail, or nothing when the
-- link was not good, so a link can never be spent twice.
create or replace function login_setup_spend(p_token_hash text, p_password_hash text)
returns table (email text)
language plpgsql volatile security definer set search_path = public as $$
declare
  v_login uuid;
begin
  update login_setups s set used_at = now()
   where s.token_hash = p_token_hash and s.used_at is null and s.expires_at > now()
     and exists (select 1 from logins l
                   join people p on p.id = l.person_id and p.archived_at is null
                   join businesses b on b.id = l.business_id and b.is_active
                  where l.id = s.login_id and l.archived_at is null)
  returning s.login_id into v_login;
  if v_login is null then return; end if;
  update login_setups set used_at = now() where login_id = v_login and used_at is null;
  update logins
     set password_hash = p_password_hash, password_changed_at = now(),
         failed_attempts = 0, locked_until = null
   where id = v_login;
  return query select l.email from logins l where l.id = v_login;
end $$;
revoke all on function login_setup_spend(text, text) from public;
grant execute on function login_setup_spend(text, text) to nomi_app;

insert into _migrations (version, name) values (78, 'login_setups')
on conflict (version) do nothing;
