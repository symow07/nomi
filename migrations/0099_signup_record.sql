-- 0099 — what a self-serve sign-up leaves on the record (G1, the onboarding
-- plan's phase 5).
--
--   · businesses.signed_up_at — the moment a workspace was made by sign-up.
--     `onboarding_state.signup_at` (0013) is written on the first Getting
--     ready action, not at sign-up, so it cannot mark a self-serve workspace;
--     a workspace the operator made has none.
--   · businesses.auto_earned_at — when the workspace earned sending alone
--     (the ramp, R2, writes it; nothing does yet).
--   · businesses.terms_version / terms_accepted_at — which terms of service
--     the owner agreed to at sign-up (a digest of the text served), and when.
--   · self_serve_count() — how many self-serve workspaces exist: the cohort
--     cap is counted here, under one lock, so two sign-ups at once cannot
--     both take the last place.
--   · signups_since(t) — the operator's daily digest: who signed up, never
--     anything a customer said.

alter table businesses
  add column if not exists signed_up_at timestamptz,
  add column if not exists auto_earned_at timestamptz,
  add column if not exists terms_version text check (terms_version is null or terms_version ~ '^[0-9a-f]{12}$'),
  add column if not exists terms_accepted_at timestamptz;

create or replace function self_serve_count() returns integer
language plpgsql security definer set search_path = public as $$
begin
  -- One sign-up at a time past this point, until the caller's transaction ends.
  perform pg_advisory_xact_lock(hashtext('self_serve_count'));
  return (select count(*)::integer from businesses where signed_up_at is not null and practice_of is null);
end $$;
revoke all on function self_serve_count() from public;
grant execute on function self_serve_count() to nomi_app;

create or replace function signups_since(p_since timestamptz)
returns table (name text, kind text, country text, signed_up_at timestamptz)
language sql security definer set search_path = public as $$
  select b.name, b.kind, b.country, b.signed_up_at
    from businesses b
   where b.signed_up_at >= p_since and b.practice_of is null
   order by b.signed_up_at
$$;
revoke all on function signups_since(timestamptz) from public;
grant execute on function signups_since(timestamptz) to nomi_app;

insert into _migrations (version, name) values (99, 'signup_record')
on conflict (version) do nothing;
