-- 0114 — the sign-up's own guards before open mode (BOT; decision 36, KS1's
-- second half). Until now: five attempts an hour per caller held in the
-- process's memory (a deploy resets it, rotating addresses walks past it), six
-- codes an hour per address in the database (0058), nothing per domain, and the
-- sign-up mode only in a deployment variable. With MAIL's daily caps (0112),
-- this is the rest:
--
--   · signup_settings — one row: the operator's sign-up switch, read on every
--     request. NULL follows the deployment's SIGNUP_MODE; open, invite or closed
--     overrides it at once, without a deploy (tools/signup-mode.mjs).
--   · signup_throttles — per caller and per recipient domain, by the UTC hour,
--     keys kept only as their SHA-256; claimed by two functions, rows older than
--     two days dropped as they go.
--   · signup_invites.revoked_at / revoked_by — an invitation the operator takes
--     back lapses at once (tools/invitations.mjs); 0055's and 0100's checks
--     already refuse a lapsed one, so neither function changes.

create table if not exists signup_settings (
  id boolean primary key default true check (id),
  mode text check (mode is null or mode in ('open', 'invite', 'closed')),
  set_at timestamptz not null default now(),
  set_by text check (set_by is null or length(btrim(set_by)) between 1 and 120)
);
insert into signup_settings (id) values (true) on conflict (id) do nothing;
-- The schema's default privileges (0005) grant the app role every new table:
-- taken back, so the app reaches it only through the functions below.
alter table signup_settings enable row level security;
revoke all on signup_settings from public, nomi_app;

create or replace function signup_mode_set()
returns text
language sql stable security definer set search_path = public as $$
  select mode from signup_settings where id
$$;
revoke all on function signup_mode_set() from public;
grant execute on function signup_mode_set() to nomi_app;

create table if not exists signup_throttles (
  kind text not null check (kind in ('caller', 'domain')),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  hour timestamptz not null,
  n integer not null default 0 check (n >= 0),
  primary key (kind, key_hash, hour)
);
create index if not exists signup_throttles_hour on signup_throttles (hour);
alter table signup_throttles enable row level security;
revoke all on signup_throttles from public, nomi_app;

-- Counts one try against (kind, key) this UTC hour; true while within the limit.
-- A refused try is counted too, so hammering a full bucket keeps it full.
create or replace function claim_signup_throttle(p_kind text, p_key text, p_limit integer)
returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare
  v_n integer;
begin
  if p_kind not in ('caller', 'domain') or p_limit is null or p_limit < 1 then
    raise exception 'claim_signup_throttle: bad arguments' using errcode = '22023';
  end if;
  delete from signup_throttles where hour < now() - interval '2 days';
  insert into signup_throttles as t (kind, key_hash, hour, n)
  values (p_kind, encode(sha256(convert_to(lower(btrim(coalesce(p_key, ''))), 'UTF8')), 'hex'),
          date_trunc('hour', now() at time zone 'UTC') at time zone 'UTC', 1)
  on conflict (kind, key_hash, hour) do update set n = t.n + 1
  returning n into v_n;
  return v_n <= p_limit;
end $$;
revoke all on function claim_signup_throttle(text, text, integer) from public;
grant execute on function claim_signup_throttle(text, text, integer) to nomi_app;

alter table signup_invites add column if not exists revoked_at timestamptz;
alter table signup_invites add column if not exists revoked_by text
  check (revoked_by is null or length(btrim(revoked_by)) between 1 and 120);

insert into _migrations (version, name) values (114, 'signup_guard')
on conflict (version) do nothing;
