-- ---------------------------------------------------------------------------
-- 0057 — A4: when each person was last here.
--
-- The account's admin asked for one page showing everyone who works there and
-- who is signed in now. "Signed in" cannot be read off a session, because there
-- is no session store (session.ts) — so it is read off what people DO: the
-- check S1 added already asks, at most once a minute per person, whether the
-- person behind a cookie still works here. It now also writes the time it
-- asked. "Online now" is "seen in the last five minutes".
--
-- One nullable column. Null means "has not been here since this was added",
-- which is what the page says — not "never signed in", which nobody can know
-- about the time before it.
-- ---------------------------------------------------------------------------

alter table people
  add column if not exists last_seen_at timestamptz;

insert into _migrations (version, name) values (57, 'people_last_seen')
on conflict (version) do nothing;
