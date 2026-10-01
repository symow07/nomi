-- 0113 — the spend breaker (KS5, the onboarding plan's phase 7b; decision 37).
--
-- G3 caps each workspace's day (0101). Nothing capped the installation's: many
-- workspaces each inside their own cap can still run up a bill the operator
-- did not mean to pay. Past a daily ceiling for the whole installation, the
-- workspaces that signed themselves up (the beta) wait for their owners until
-- midnight UTC, exactly as when their own allowance is used; the pilots — a
-- workspace the operator made, or opened by hand — keep running.
--
--   · installation_limits — one row: the day's ceiling in tokens and in model
--     calls. 20,000,000 tokens and 20,000 calls by default: twenty workspaces
--     at G3's cap. The operator changes it (tools/spend-ceiling.mjs).
--   · spend_breaker_held() — for the CURRENT business: is it beta, and is the
--     installation past its ceiling today? A practice copy answers as its
--     workspace.
--   · spend_breaker_alerts + claim_spend_breaker_alert() — the operator's
--     e-mail, once a UTC day, the first sweep after the ceiling is passed.

create table if not exists installation_limits (
  id boolean primary key default true check (id),
  daily_tokens bigint not null default 20000000 check (daily_tokens > 0),
  daily_calls integer not null default 20000 check (daily_calls > 0),
  set_at timestamptz not null default now(),
  set_by text
);
insert into installation_limits (id) values (true) on conflict (id) do nothing;
-- The schema's default privileges (0005) grant the app role every new table:
-- taken back, so the app reaches it only through the functions below.
alter table installation_limits enable row level security;
revoke all on installation_limits from public, nomi_app;

create or replace function installation_usage_today()
returns table (tokens bigint, calls bigint, max_tokens bigint, max_calls integer)
language sql stable security definer set search_path = public as $$
  select coalesce(sum(u.input_tokens + u.output_tokens), 0)::bigint, coalesce(sum(u.llm_calls), 0)::bigint,
         (select daily_tokens from installation_limits), (select daily_calls from installation_limits)
    from usage_ledger u where u.day = (now() at time zone 'UTC')::date;
$$;
revoke all on function installation_usage_today() from public;
grant execute on function installation_usage_today() to nomi_app;

create or replace function spend_breaker_held()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.signed_up_at is not null
       -- Opened by hand reads as in 0106: a stamp with no writer is the operator's.
       and not (p.auto_earned_at is not null and coalesce(p.auto_earned_by, 'operator') <> 'ramp')
       and (i.tokens >= i.max_tokens or i.calls >= i.max_calls)
      from businesses me
      join businesses p on p.id = coalesce(me.practice_of, me.id)
      cross join installation_usage_today() i
     where me.id = current_business_id()), false);
$$;
revoke all on function spend_breaker_held() from public;
grant execute on function spend_breaker_held() to nomi_app;

create table if not exists spend_breaker_alerts (
  day date primary key,
  sent_at timestamptz not null default now()
);
alter table spend_breaker_alerts enable row level security;
revoke all on spend_breaker_alerts from public, nomi_app;

create or replace function claim_spend_breaker_alert()
returns table (tokens bigint, calls bigint, max_tokens bigint, max_calls integer)
language plpgsql volatile security definer set search_path = public as $$
begin
  return query
  with today as (select * from installation_usage_today()),
       claimed as (
         insert into spend_breaker_alerts (day)
         select (now() at time zone 'UTC')::date from today t
          where t.tokens >= t.max_tokens or t.calls >= t.max_calls
         on conflict (day) do nothing
         returning day)
  select t.tokens, t.calls, t.max_tokens, t.max_calls from today t where exists (select 1 from claimed);
end $$;
revoke all on function claim_spend_breaker_alert() from public;
grant execute on function claim_spend_breaker_alert() to nomi_app;

insert into _migrations (version, name) values (113, 'spend_breaker')
on conflict (version) do nothing;
