-- ---------------------------------------------------------------------------
-- 0129 — a reset link goes only to an address that has answered (PWR2, the
-- self-service reset build, 2026-10-04).
--
-- Until now "Forgot your password?" (0084) mailed a link to whatever address a
-- login was made with. Most were proven — sign-up asks the address for a code
-- (A3) — but not every way a login comes to exist asks: an installation that
-- had no system mail when somebody signed up made the login unasked, and a
-- typo there would hand the workspace to whoever owns the typed address the
-- day mail is switched on and they ask for a link.
--
--   · logins.email_verified_at — when the address was last shown to be the
--     person's: a code sent to it was typed back (sign-up, a new browser), a
--     link sent to it was spent, or the operator wrote it in by hand
--     (tools/add-login.mjs: the operator vouches for it). Kept, never cleared.
--   · filled in here from what the database already knows: a code that was
--     typed back for the address, a link that set the password, or a link the
--     operator made for the login.
--   · login_setup_request: a login whose address has never answered gets no
--     link — and the door says the same words, as for an unknown address.
--   · login_setup_spend: spending a link proves the address too (the same
--     function as 0078, plus that one column).
--   · login_email_proven(login): the application's way to write it after a code
--     was typed back. Only ever sets it; never clears it.
-- ---------------------------------------------------------------------------

alter table logins add column if not exists email_verified_at timestamptz;

update logins l
   set email_verified_at = coalesce(
     (select min(c.consumed_at) from login_codes c where c.email = l.email and c.consumed_at is not null),
     (select min(s.used_at) from login_setups s where s.login_id = l.id and s.used_at is not null and s.used_at = l.password_changed_at),
     (select min(s.created_at) from login_setups s where s.login_id = l.id and s.made_by <> 'recovery'))
 where l.email_verified_at is null;

create or replace function login_email_proven(p_login uuid)
returns void
language sql volatile security definer set search_path = public as $$
  update logins set email_verified_at = now()
   where id = p_login and archived_at is null and email_verified_at is null
$$;
revoke all on function login_email_proven(uuid) from public;
grant execute on function login_email_proven(uuid) to nomi_app;

create or replace function login_setup_request(p_email text, p_token_hash text, p_minutes integer)
returns table (email text)
language plpgsql volatile security definer set search_path = public as $$
declare
  v_login uuid;
  v_business uuid;
  v_email text;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_minutes is null or p_minutes < 5 or p_minutes > 1440 then
    return;
  end if;
  select l.id, l.business_id, l.email into v_login, v_business, v_email
    from logins l
    join people p on p.id = l.person_id and p.archived_at is null
    join businesses b on b.id = l.business_id and b.is_active
   where l.email = lower(btrim(p_email)) and l.archived_at is null and l.email_verified_at is not null
   limit 1;
  if v_login is null then return; end if;
  if (select count(*) from login_setups
       where login_id = v_login and made_by = 'recovery' and created_at > now() - interval '1 hour') >= 3 then
    return;
  end if;
  update login_setups set used_at = now() where login_id = v_login and used_at is null;
  insert into login_setups (business_id, login_id, token_hash, expires_at, made_by)
  values (v_business, v_login, p_token_hash, now() + make_interval(mins => p_minutes), 'recovery');
  return query select v_email;
end $$;
revoke all on function login_setup_request(text, text, integer) from public;
grant execute on function login_setup_request(text, text, integer) to nomi_app;

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
         failed_attempts = 0, locked_until = null,
         email_verified_at = coalesce(email_verified_at, now())
   where id = v_login;
  return query select l.email from logins l where l.id = v_login;
end $$;
revoke all on function login_setup_spend(text, text) from public;
grant execute on function login_setup_spend(text, text) to nomi_app;

insert into _migrations (version, name) values (129, 'login_email_proven')
on conflict (version) do nothing;
