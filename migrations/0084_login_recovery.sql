-- ---------------------------------------------------------------------------
-- 0084 — "e-mail me a link": an owner who forgot the password asks for one on
-- the door (PWR, the one-month build order, 2026-09-29).
--
-- Until now a forgotten password was the operator's: tools/add-login.mjs
-- --reset (0078). The pieces for self-service were there — `login_setups`, the
-- one-time link and its page (`/login/set-password`), and the system mail that
-- sends sign-in codes — but nothing on the door could ask for a link.
--
-- The application makes the random token and keeps it only long enough to
-- mail it; this function stores its SHA-256, like 0078, for the one live login
-- the e-mail signs in with, and answers with that e-mail — or with nothing,
-- and the door says the same words either way.
--
--   · three links an hour per login, whoever asks, counted here, so a mailbox
--     cannot be flooded and a restart forgets nothing;
--   · the newest link is the one that works: asking again closes the older
--     ones (as spending one does, 0078);
--   · a switched-off workspace, an archived login or person gets nothing.
-- ---------------------------------------------------------------------------

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
   where l.email = lower(btrim(p_email)) and l.archived_at is null
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

insert into _migrations (version, name) values (84, 'login_recovery')
on conflict (version) do nothing;
