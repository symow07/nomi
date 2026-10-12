-- ---------------------------------------------------------------------------
-- 0138 — D2 (the data-protection audit, 2026-10-12): A SIGN-UP'S CALLER IS
-- FORGOTTEN EVERY DAY.
--
-- The sign-up guard (0114) counts tries per caller — the internet address a
-- sign-up came from, kept only as its SHA-256 — in `signup_throttles`. Rows
-- older than two days were deleted only inside `claim_signup_throttle`, that
-- is, only when someone else signed up: with few sign-ups, a caller's hash
-- stayed for as long as nobody else came. A hash of an internet address is
-- still the address (there are few enough of them to try every one).
--
-- From here the daily ops.signup_expiry job (0137) also calls
-- `signup_throttles_forget`, so no row outlives three days: two days past the
-- hour it counts, and at most one more until the job runs. The privacy page
-- says so.
-- ---------------------------------------------------------------------------

create or replace function signup_throttles_forget()
returns integer
language plpgsql volatile security definer set search_path = public as $$
declare
  n integer;
begin
  delete from signup_throttles where hour < now() - interval '2 days';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function signup_throttles_forget() from public;
grant execute on function signup_throttles_forget() to nomi_app;

-- What is already here: the same rule, now.
delete from signup_throttles where hour < now() - interval '2 days';

insert into _migrations (version, name) values (138, 'signup_callers')
  on conflict (version) do nothing;
