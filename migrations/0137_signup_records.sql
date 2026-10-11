-- ---------------------------------------------------------------------------
-- 0137 — D1 (the data-protection audit, 2026-10-12): A SIGN-UP IS NOT KEPT.
--
-- `login_codes` (0058) holds a sign-up while its code waits: the whole form,
-- the business's answers and the password HASH. Nothing ever cleared it. A
-- finished sign-up kept its form after the workspace existed; an abandoned one
-- kept it for good; and closing a workspace — which the page /closed says
-- leaves "nothing of it" — missed these rows, which carry no login yet.
--
-- From here:
--   · on completion: the code that made the workspace gives its form back to
--     the caller once and keeps none of it (otp_redeem);
--   · unfinished: a sign-up whose code lapsed, was replaced or was spent loses
--     its form AND its address an hour after its code expired, once a day
--     (login_codes_forget, the ops.signup_expiry job);
--   · on closing: when a workspace's login is deleted, every sign-up row for
--     its address loses both (the trigger below);
--   · what is already here: the same rules, now.
--
-- The rows themselves stay, blank: the funnel counts sign-up forms and how
-- many came back (0104 `signup_forms_since`), and a count needs no person.
-- A device code (a new browser's sign-in) is untouched here.
-- ---------------------------------------------------------------------------

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
  -- 0137 — the form is handed back once, here, and not kept.
  update login_codes set consumed_at = now(), payload = null where login_codes.id = p_id;
  return query select true, null::text, v.email, v.purpose, v.payload, v.login_id;
end $$;
revoke all on function otp_redeem(uuid, text) from public;
grant execute on function otp_redeem(uuid, text) to nomi_app;

-- An unfinished sign-up, an hour after its code expired: no form, no address.
create or replace function login_codes_forget()
returns integer
language plpgsql volatile security definer set search_path = public as $$
declare
  n integer;
begin
  update login_codes set payload = null, email = ''
   where purpose = 'signup' and payload is not null and expires_at < now() - interval '1 hour';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function login_codes_forget() from public;
grant execute on function login_codes_forget() to nomi_app;

-- A login deleted (a workspace closing): every sign-up row for its address goes blank.
create or replace function login_codes_forget_address()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update login_codes set payload = null, email = ''
   where purpose = 'signup' and email = old.email;
  return old;
end $$;
revoke all on function login_codes_forget_address() from public;

drop trigger if exists logins_forget_signups on logins;
create trigger logins_forget_signups after delete on logins
  for each row execute function login_codes_forget_address();

-- What is already here. A form is needed only while its code is open.
update login_codes set payload = null
 where purpose = 'signup' and payload is not null
   and (consumed_at is not null or expires_at < now() - interval '1 hour');
-- An address with no live login behind it was never finished, or its workspace is gone.
update login_codes c set email = ''
 where c.purpose = 'signup' and c.email <> '' and c.expires_at < now() - interval '1 hour'
   and not exists (select 1 from logins l where l.email = c.email and l.archived_at is null);

insert into _migrations (version, name) values (137, 'signup_records')
  on conflict (version) do nothing;
