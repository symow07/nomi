-- ---------------------------------------------------------------------------
-- 0166 — EVERY FIVE-MINUTE CHECK, KEPT FOR A MONTH (the owner, 2026-10-15: "If
-- DeepSeek is still unreliable in 48 hours, the fallback becomes the primary
-- and we re-measure properly. Tell me when we hit that mark.")
--
-- `model_checks` (0165) holds the LAST word per provider. Whether a provider
-- is reliable is a question about all of them: each check (never a real call:
-- those are the workspaces') is appended here, with its provider, model,
-- state, latency and why, and `tools/model-uptime.mjs` reads a window of it.
-- Kept thirty days: the check removes what is older through
-- `prune_model_check_log()`, which decides the cutoff itself — the app role
-- holds DELETE on nothing (G20, tests/integration/grants.test.ts).
-- ---------------------------------------------------------------------------

create table if not exists model_check_log (
  id        bigint generated always as identity primary key,
  role      text not null check (role in ('primary', 'fallback')),
  provider  text not null,
  model     text not null,
  state     text not null check (state in ('answering', 'slow', 'not_answering')),
  ms        integer check (ms is null or ms >= 0),
  reason    text check (reason is null or length(reason) <= 40),
  at        timestamptz not null
);
create index if not exists model_check_log_at on model_check_log (role, at);

grant select, insert on model_check_log to nomi_app;
revoke update, delete, truncate on model_check_log from nomi_app;

create or replace function prune_model_check_log() returns integer
language sql volatile security definer set search_path = public as $$
  with gone as (delete from model_check_log where at < now() - interval '30 days' returning 1)
  select count(*)::int from gone
$$;
revoke all on function prune_model_check_log() from public;
grant execute on function prune_model_check_log() to nomi_app;

insert into _migrations (version, name) values (166, 'model_check_log')
  on conflict (version) do nothing;
