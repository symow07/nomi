-- ---------------------------------------------------------------------------
-- 0058 — A3: a six-digit code by e-mail, when an account is made and when a
-- browser we have not seen signs in.
--
-- A password proves she knows a secret. It does not prove the address is hers
-- (so a typo'd or borrowed address could own a workspace), and it does not stop
-- someone who learned the password on another device. A code sent to the
-- address does both.
--
-- `login_codes` holds a code that is WAITING — and, for a sign-up, the whole
-- sign-up that waits with it (the business's answers and the password HASH,
-- never the password). Nothing becomes a tenant until the code comes back, so
-- an address nobody reads never owns a workspace and an invitation is not spent
-- on one.
--
-- To the application role this table does not exist, like `signup_invites`:
-- it may issue, re-issue and redeem through three definer functions and
-- nothing else. The code is stored as a keyed hash; the row cannot give it back.
--
-- The limits live HERE, not in the process, so they hold across restarts and
-- replicas: five tries per code, ten minutes per code, six codes an hour per
-- address.
-- ---------------------------------------------------------------------------

create table if not exists login_codes (
  id           uuid primary key default gen_random_uuid(),
  email        text not null check (email = lower(btrim(email))),
  purpose      text not null check (purpose in ('signup', 'device')),
  code_hash    text not null,
  -- signup: what she typed, waiting. device: null.
  payload      jsonb,
  -- device: whose browser this is about. signup: null (no login exists yet).
  login_id     uuid references logins(id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  attempts     integer not null default 0,
  consumed_at  timestamptz
);

create index if not exists login_codes_recent on login_codes (email, created_at desc);

alter table login_codes enable row level security;
revoke all on login_codes from nomi_app;

-- Issue a code. Any earlier open code for the same address and purpose is
-- closed, so only the newest mail works. Returns null when the address has been
-- sent too many already — the caller says "wait", and no mail is sent.
create or replace function otp_issue(
  p_email text, p_purpose text, p_code_hash text, p_payload jsonb, p_login uuid, p_ttl_seconds integer
)
returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  v_email text := lower(btrim(p_email));
  v_id    uuid;
begin
  if (select count(*) from login_codes where email = v_email and created_at > now() - interval '1 hour') >= 6 then
    return null;
  end if;
  update login_codes set consumed_at = now()
   where email = v_email and purpose = p_purpose and consumed_at is null;
  insert into login_codes (email, purpose, code_hash, payload, login_id, expires_at)
  values (v_email, p_purpose, p_code_hash, p_payload, p_login,
          now() + make_interval(secs => greatest(60, least(p_ttl_seconds, 3600))))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function otp_issue(text, text, text, jsonb, uuid, integer) from public;
grant execute on function otp_issue(text, text, text, jsonb, uuid, integer) to nomi_app;

-- "Send me another." Same waiting sign-up, new code, old one closed. Only for a
-- code that is still open and less than half an hour old. Null otherwise.
create or replace function otp_reissue(p_id uuid, p_code_hash text, p_ttl_seconds integer)
returns table (id uuid, email text, purpose text)
language plpgsql volatile security definer set search_path = public as $$
declare
  v_old login_codes%rowtype;
begin
  select * into v_old from login_codes c
   where c.id = p_id and c.consumed_at is null and c.created_at > now() - interval '30 minutes';
  if not found then return; end if;
  return query
    select n, v_old.email, v_old.purpose
      from otp_issue(v_old.email, v_old.purpose, p_code_hash, v_old.payload, v_old.login_id, p_ttl_seconds) n
     where n is not null;
end $$;
revoke all on function otp_reissue(uuid, text, integer) from public;
grant execute on function otp_reissue(uuid, text, integer) to nomi_app;

-- Redeem. Every call counts as a try, right or wrong. `reason` says why not:
--   gone      no such code, already used, or replaced by a newer one
--   expired   its ten minutes are over
--   spent     five tries were used
--   wrong     not the code
create or replace function otp_redeem(p_id uuid, p_code_hash text)
returns table (ok boolean, reason text, email text, purpose text, payload jsonb, login_id uuid)
language plpgsql volatile security definer set search_path = public as $$
declare
  v login_codes%rowtype;
begin
  update login_codes c set attempts = c.attempts + 1
   where c.id = p_id and c.consumed_at is null
  returning * into v;
  if not found then
    return query select false, 'gone'::text, null::text, null::text, null::jsonb, null::uuid; return;
  end if;
  if v.expires_at <= now() then
    return query select false, 'expired'::text, v.email, v.purpose, null::jsonb, null::uuid; return;
  end if;
  if v.attempts > 5 then
    update login_codes set consumed_at = now() where login_codes.id = p_id;
    return query select false, 'spent'::text, v.email, v.purpose, null::jsonb, null::uuid; return;
  end if;
  if v.code_hash <> p_code_hash then
    return query select false, 'wrong'::text, v.email, v.purpose, null::jsonb, null::uuid; return;
  end if;
  update login_codes set consumed_at = now() where login_codes.id = p_id;
  return query select true, null::text, v.email, v.purpose, v.payload, v.login_id;
end $$;
revoke all on function otp_redeem(uuid, text) from public;
grant execute on function otp_redeem(uuid, text) to nomi_app;

insert into _migrations (version, name) values (58, 'login_codes')
on conflict (version) do nothing;
