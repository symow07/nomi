-- 0128 — billing resilience (2026-10-04): the model provider's account.
--
-- On 2026-10-01 the provider stopped answering because the account was out of
-- credit, and Nomi stalled for hours with nothing saying why. Three things are
-- written down now:
--
--   · provider_health — one row: is the provider refusing for billing, since
--     when, in its own words (the operator's only), how many escalating alerts
--     went, and whether the "it answers again" notice is owed. The app learns
--     the state from every call it makes (src/pipeline/providerWatch.ts).
--   · a conversation handed to a person because of it carries its own reason,
--     'provider_billing', in both CHECK lists (0117's, copied exactly, with
--     the one new word).
--   · provider_balance_checks / provider_balance_alerts — the provider's own
--     balance, read hourly where it offers one (DeepSeek), and which warning
--     steps went (each once, until a top-up re-arms it). Operator figures:
--     no owner page reads them.
--
-- The schema's default privileges (0005) grant the app role every new table:
-- taken back, as in 0113, so the app reaches these only through the functions.

-- ── The hand-off reason ────────────────────────────────────────────────────
alter table conversation_signals drop constraint if exists conversation_signals_kind_check;
alter table conversation_signals add constraint conversation_signals_kind_check
  check (kind in (
    'human_requested','complaint','repeated_ambiguity',
    'low_confidence_image','high_value','customization_requested',
    'logistics_discussed','moq_accepted','price_acknowledged',
    'audio_unheard','media_unreadable','unlisted_number','email_reply',
    'assistant_stopped','ops_silenced','deletion_requested','not_answered','price_to_owner',
    'allowance_used','stock_asked','billing_lapsed','plan_limit','provider_billing'));

alter table escalation_events drop constraint if exists escalation_events_trigger_reason_check;
alter table escalation_events add constraint escalation_events_trigger_reason_check
  check (trigger_reason in (
    'high_value','unclear_product','customization','complex_negotiation',
    'repeated_ambiguity','client_request','logistics_payment','manual',
    'low_confidence_image','audio_unheard','media_unreadable','unlisted_number','email_reply',
    'assistant_stopped','ops_silenced','deletion_requested','not_answered','price_to_owner',
    'allowance_used','stock_asked','billing_lapsed','plan_limit','provider_billing'));

-- ── The provider's state ───────────────────────────────────────────────────
create table if not exists provider_health (
  id                 boolean primary key default true check (id),
  refusing_since     timestamptz,
  reason             text check (reason is null or reason in ('billing')),
  last_refused_at    timestamptz,
  refusals           integer not null default 0 check (refusals >= 0),
  words              text check (words is null or length(words) <= 300),
  alerts_sent        integer not null default 0 check (alerts_sent >= 0),
  last_alert_at      timestamptz,
  -- The last outage, once it ended: from, to, and whether its end is still to be told.
  last_since         timestamptz,
  answered_again_at  timestamptz,
  recovery_owed      boolean not null default false,
  check ((refusing_since is null) = (reason is null))
);
insert into provider_health (id) values (true) on conflict (id) do nothing;
alter table provider_health enable row level security;
revoke all on provider_health from public, nomi_app;

-- Is it refusing? The one fact an owner's page reads (true/false, no words, no figures).
create or replace function provider_refusing()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select refusing_since is not null from provider_health where id), false);
$$;
revoke all on function provider_refusing() from public;
grant execute on function provider_refusing() to nomi_app;

-- The whole row, for the operator's sweep and /health.
create or replace function provider_health_now()
returns table (refusing_since timestamptz, reason text, last_refused_at timestamptz, refusals integer,
               words text, alerts_sent integer, last_alert_at timestamptz,
               last_since timestamptz, answered_again_at timestamptz, recovery_owed boolean)
language sql stable security definer set search_path = public as $$
  select h.refusing_since, h.reason, h.last_refused_at, h.refusals, h.words, h.alerts_sent, h.last_alert_at,
         h.last_since, h.answered_again_at, h.recovery_owed
    from provider_health h where h.id;
$$;
revoke all on function provider_health_now() from public;
grant execute on function provider_health_now() to nomi_app;

-- A billing refusal: starts the outage, or counts another while it lasts.
-- `began` is true when this refusal started it. Its start is kept to the
-- millisecond: the app reads it back as a JavaScript date and names it again
-- when it claims an alert, so it must survive the round trip exactly.
create or replace function provider_refused(p_reason text, p_words text)
returns table (since timestamptz, began boolean)
language plpgsql volatile security definer set search_path = public as $$
declare was timestamptz;
begin
  select h.refusing_since into was from provider_health h where h.id for update;
  update provider_health h set
    refusing_since  = coalesce(h.refusing_since, date_trunc('milliseconds', now())),
    reason          = p_reason,
    last_refused_at = now(),
    refusals        = case when was is null then 1 else h.refusals + 1 end,
    words           = left(coalesce(p_words, ''), 300),
    alerts_sent     = case when was is null then 0 else h.alerts_sent end,
    last_alert_at   = case when was is null then null else h.last_alert_at end,
    recovery_owed   = case when was is null then false else h.recovery_owed end
   where h.id;
  return query select h.refusing_since, was is null from provider_health h where h.id;
end $$;
revoke all on function provider_refused(text, text) from public;
grant execute on function provider_refused(text, text) to nomi_app;

-- An answer: ends the outage, if there was one. Its end is owed to the operator
-- only if an alert about it went out.
create or replace function provider_answered()
returns table (since timestamptz, until timestamptz)
language plpgsql volatile security definer set search_path = public as $$
begin
  return query
  update provider_health h set
    last_since        = h.refusing_since,
    answered_again_at = now(),
    recovery_owed     = h.alerts_sent > 0,
    refusing_since    = null,
    reason            = null
   where h.id and h.refusing_since is not null
  returning h.last_since, h.answered_again_at;
end $$;
revoke all on function provider_answered() from public;
grant execute on function provider_answered() to nomi_app;

-- Step `p_step` of the escalation, for the refusal that began at `p_since`: once.
create or replace function claim_provider_alert(p_step integer, p_since timestamptz)
returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare n integer;
begin
  update provider_health h set alerts_sent = p_step + 1, last_alert_at = now()
   where h.id and date_trunc('milliseconds', h.refusing_since) = date_trunc('milliseconds', p_since)
     and h.alerts_sent = p_step;
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function claim_provider_alert(integer, timestamptz) from public;
grant execute on function claim_provider_alert(integer, timestamptz) to nomi_app;

-- The "it answers again" notice: once per outage that was alerted.
create or replace function claim_provider_recovery()
returns table (since timestamptz, until timestamptz)
language plpgsql volatile security definer set search_path = public as $$
begin
  return query
  update provider_health h set recovery_owed = false
   where h.id and h.recovery_owed and h.refusing_since is null
  returning h.last_since, h.answered_again_at;
end $$;
revoke all on function claim_provider_recovery() from public;
grant execute on function claim_provider_recovery() to nomi_app;

-- ── The balance (DeepSeek's /user/balance; Anthropic has none) ─────────────
create table if not exists provider_balance_checks (
  id          bigserial primary key,
  checked_at  timestamptz not null default now(),
  available   boolean not null,
  currency    text not null check (currency ~ '^[A-Z]{3}$'),
  total       numeric(16,4) not null,
  granted     numeric(16,4),
  topped_up   numeric(16,4)
);
create index if not exists provider_balance_checks_at on provider_balance_checks (checked_at desc);
alter table provider_balance_checks enable row level security;
revoke all on provider_balance_checks from public, nomi_app;

create table if not exists provider_balance_alerts (
  step     text primary key check (step in ('floor', 'days3', 'days1', 'unavailable')),
  sent_at  timestamptz not null default now(),
  -- true once the step stopped being true: the next time it is, it is sent again.
  armed    boolean not null default false
);
alter table provider_balance_alerts enable row level security;
revoke all on provider_balance_alerts from public, nomi_app;

create or replace function record_provider_balance(
  p_available boolean, p_currency text, p_total numeric, p_granted numeric, p_topped_up numeric)
returns void
language sql volatile security definer set search_path = public as $$
  insert into provider_balance_checks (available, currency, total, granted, topped_up)
  values (p_available, upper(p_currency), p_total, p_granted, p_topped_up);
$$;
revoke all on function record_provider_balance(boolean, text, numeric, numeric, numeric) from public;
grant execute on function record_provider_balance(boolean, text, numeric, numeric, numeric) to nomi_app;

create or replace function provider_balance_since(p_since timestamptz)
returns table (checked_at timestamptz, currency text, total numeric)
language sql stable security definer set search_path = public as $$
  select c.checked_at, c.currency, c.total from provider_balance_checks c
   where c.checked_at >= p_since order by c.checked_at;
$$;
revoke all on function provider_balance_since(timestamptz) from public;
grant execute on function provider_balance_since(timestamptz) to nomi_app;

-- A step is sent the first time it is true, and again only after it was re-armed.
create or replace function claim_balance_alert(p_step text)
returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare n integer;
begin
  insert into provider_balance_alerts as a (step) values (p_step)
  on conflict (step) do update set sent_at = now(), armed = false where a.armed;
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function claim_balance_alert(text) from public;
grant execute on function claim_balance_alert(text) to nomi_app;

-- The steps no longer true are armed again (a top-up, a grant).
create or replace function rearm_balance_alerts(p_true text[])
returns void
language sql volatile security definer set search_path = public as $$
  update provider_balance_alerts set armed = true
   where not armed and not (step = any (coalesce(p_true, '{}')));
$$;
revoke all on function rearm_balance_alerts(text[]) from public;
grant execute on function rearm_balance_alerts(text[]) to nomi_app;

insert into _migrations (version, name) values (128, 'provider_billing')
on conflict (version) do nothing;
