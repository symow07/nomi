-- 0243 — Log out ends the session on the server, not only in the browser.
--
-- The session is a signed cookie with no store behind it (src/api/web/session.ts). Until now Log out only told the
-- browser to forget it: a copy of the cookie (a shared computer, a stolen cookie, a proxy's log) kept opening the app
-- for up to seven days after the owner signed out. Found by the Block 5 tester, 2026-11-20.
--
-- From now on every session carries a random id (`sid`), and Log out writes that id here. The session gate refuses an
-- id that is here. Only THIS session ends: another browser of the same person stays signed in (changing the password
-- is what ends every other session, S1).
--
-- The table names no business and no person: a random id and when its cookie would have expired anyway. There is
-- nothing in it to erase with a customer or a workspace, and nothing another workspace could read. The app role
-- reaches it only through the two functions below.

create table if not exists ended_sessions (
  sid uuid primary key,
  -- When the cookie would have stopped verifying by itself: after this the row says nothing and is pruned.
  ends_at timestamptz not null
);
create index if not exists ended_sessions_ends_at on ended_sessions (ends_at);
alter table ended_sessions enable row level security;
revoke all on ended_sessions from public, nomi_app;

-- Records one ended session. Idempotent: a second Log out of the same cookie changes nothing. Rows whose cookie has
-- expired are pruned as it goes (the app role has no DELETE anywhere).
create or replace function end_session(p_sid uuid, p_ends_at timestamptz)
returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if p_sid is null or p_ends_at is null then
    raise exception 'end_session: bad arguments' using errcode = '22023';
  end if;
  delete from ended_sessions where ends_at < now() - interval '1 day';
  insert into ended_sessions (sid, ends_at)
  values (p_sid, least(p_ends_at, now() + interval '8 days'))
  on conflict (sid) do nothing;
end $$;
revoke all on function end_session(uuid, timestamptz) from public;
grant execute on function end_session(uuid, timestamptz) to nomi_app;

create or replace function session_ended(p_sid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from ended_sessions where sid = p_sid);
$$;
revoke all on function session_ended(uuid) from public;
grant execute on function session_ended(uuid) to nomi_app;

insert into _migrations (version, name) values (243, 'ended_sessions')
on conflict (version) do nothing;
