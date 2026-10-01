-- 0117 — billing (BILL; decision 13; the owner's instruction of 2026-10-01: a
-- free trial granted on request first, folded into self-serve later; a card
-- taken upfront; the trial's clock starting at the first channel connected).
--
-- New tables, never 0013's: its `subscriptions` and `payments` were never used
-- and are priced in CNY (its `onboarding_state` stays in use).
--
--   · plans — what can be bought, defined by the operator from a Stripe price
--     (tools/billing.mjs plan-set): the unit is customers answered a month
--     (decision 13), with seats and assistants limited where the plan says.
--   · workspace_billing — one row per workspace that has started: the plan
--     chosen, the Stripe customer, when a card was saved, the trial (granted by
--     the operator, or the installation's default once self-serve), when its
--     clock started, the subscription and its state as Stripe last said.
--   · billing_settings — one row: the trial every new workspace gets once
--     trials are self-serve (null: only on request).
--   · stripe_events — every webhook event handled, by id, so a retry from
--     Stripe is handled once.
--   · ops_flags learns 'billing_required' (for everyone): while on, a workspace
--     that signed itself up connects its first channel only with a card saved.
--
-- Nothing here binds a pilot: a workspace the operator made, or one the
-- operator exempts, is never asked for a card and never held.

alter table ops_flags drop constraint if exists ops_flags_flag_check;
alter table ops_flags add constraint ops_flags_flag_check
  check (flag in ('global_silence', 'force_draft', 'silence_capability', 'practice_off', 'connections_off', 'approve_connections', 'retention', 'billing_required'));
alter table ops_flags drop constraint if exists ops_flags_check;
alter table ops_flags add constraint ops_flags_check
  check (flag in ('global_silence', 'practice_off', 'connections_off', 'approve_connections', 'retention', 'billing_required') or capability is not null);
alter table ops_flags drop constraint if exists ops_flags_billing_everyone;
alter table ops_flags add constraint ops_flags_billing_everyone
  check (flag <> 'billing_required' or business_id is null);

create table if not exists plans (
  id                 text primary key check (id ~ '^[a-z0-9][a-z0-9_-]{1,39}$'),
  name               text not null check (length(btrim(name)) between 1 and 80),
  stripe_price_id    text not null unique check (stripe_price_id ~ '^price_[A-Za-z0-9]{6,}$'),
  -- As Stripe said when the operator defined the plan: what the page shows.
  amount_minor       integer not null check (amount_minor >= 0),
  currency           text not null check (currency ~ '^[a-z]{3}$'),
  period             text not null check (period in ('month', 'year')),
  customers_a_month  integer not null check (customers_a_month > 0),
  seats              integer check (seats is null or seats > 0),
  assistants         integer check (assistants is null or assistants > 0),
  active             boolean not null default true,
  position           integer not null default 0,
  set_at             timestamptz not null default now(),
  set_by             text not null check (length(btrim(set_by)) between 1 and 120)
);
alter table plans enable row level security;
revoke all on plans from public, nomi_app;

create table if not exists billing_settings (
  id                     boolean primary key default true check (id),
  self_serve_trial_days  integer check (self_serve_trial_days is null or self_serve_trial_days between 1 and 90),
  set_at                 timestamptz not null default now(),
  set_by                 text
);
insert into billing_settings (id) values (true) on conflict (id) do nothing;
alter table billing_settings enable row level security;
revoke all on billing_settings from public, nomi_app;

create table if not exists workspace_billing (
  business_id             uuid primary key references businesses(id) on delete cascade,
  plan_id                 text references plans(id),
  stripe_customer_id      text unique check (stripe_customer_id is null or stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  card_saved_at           timestamptz,
  -- The trial: granted by the operator on request (by name), or the default.
  trial_days              integer check (trial_days is null or trial_days between 1 and 90),
  trial_granted_by        text check (trial_granted_by is null or length(btrim(trial_granted_by)) between 1 and 120),
  trial_granted_at        timestamptz,
  -- Its clock: the first channel connected.
  trial_started_at        timestamptz,
  trial_ends_at           timestamptz,
  stripe_subscription_id  text unique check (stripe_subscription_id is null or stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  status                  text not null default 'none'
                          check (status in ('none', 'trial', 'active', 'past_due', 'lapsed')),
  current_period_end      timestamptz,
  lapsed_at               timestamptz,
  exempt_by               text check (exempt_by is null or length(btrim(exempt_by)) between 1 and 120),
  -- The owner's e-mails about it, each once: the trial ending, a failed payment, the hold.
  told_trial_ending_at    timestamptz,
  told_payment_failed_at  timestamptz,
  told_lapsed_at          timestamptz,
  updated_at              timestamptz not null default now(),
  check ((trial_days is null) = (trial_granted_at is null))
);
alter table workspace_billing enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'workspace_billing' and policyname = 'workspace_billing_tenant') then
    create policy workspace_billing_tenant on workspace_billing for select to nomi_app
      using (business_id = current_business_id());
  end if;
end $$;
-- The app reads its own row; every change goes through the functions below.
revoke all on workspace_billing from public, nomi_app;
grant select on workspace_billing to nomi_app;

create table if not exists stripe_events (
  id           text primary key check (id ~ '^evt_[A-Za-z0-9]+$'),
  type         text not null,
  business_id  uuid,
  received_at  timestamptz not null default now()
);
alter table stripe_events enable row level security;
revoke all on stripe_events from public, nomi_app;

-- ── The unit: customers answered a month (decision 13) ──────────────────────
-- A customer counts once in a UTC month when the assistant drafts for them or
-- sends to them alone. Written by triggers on the two places that record it
-- (a draft; the `auto_sent` event), so no code path can forget; a practice
-- copy's customer is never counted.
create table if not exists customers_answered (
  business_id  uuid not null references businesses(id) on delete cascade,
  month        date not null check (month = date_trunc('month', month)::date),
  client_id    uuid not null references clients(id) on delete cascade,
  first_at     timestamptz not null default now(),
  primary key (business_id, month, client_id)
);
alter table customers_answered enable row level security;
revoke all on customers_answered from public, nomi_app;

create or replace function count_customer_answered() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'conversation_events' and new.type <> 'auto_sent' then return new; end if;
  insert into customers_answered (business_id, month, client_id)
  select c.business_id, date_trunc('month', now() at time zone 'UTC')::date, c.client_id
    from conversations c join businesses b on b.id = c.business_id
   where c.id = new.conversation_id and b.practice_of is null
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists drafts_count_customer on drafts;
create trigger drafts_count_customer after insert on drafts
  for each row execute function count_customer_answered();
drop trigger if exists auto_sent_count_customer on conversation_events;
create trigger auto_sent_count_customer after insert on conversation_events
  for each row when (new.type = 'auto_sent') execute function count_customer_answered();

-- ── The hand-off reasons: the billing hold, and a plan's month used ─────────
alter table conversation_signals drop constraint if exists conversation_signals_kind_check;
alter table conversation_signals add constraint conversation_signals_kind_check
  check (kind in (
    'human_requested','complaint','repeated_ambiguity',
    'low_confidence_image','high_value','customization_requested',
    'logistics_discussed','moq_accepted','price_acknowledged',
    'audio_unheard','media_unreadable','unlisted_number','email_reply',
    'assistant_stopped','ops_silenced','deletion_requested','not_answered','price_to_owner',
    'allowance_used','stock_asked','billing_lapsed','plan_limit'));

alter table escalation_events drop constraint if exists escalation_events_trigger_reason_check;
alter table escalation_events add constraint escalation_events_trigger_reason_check
  check (trigger_reason in (
    'high_value','unclear_product','customization','complex_negotiation',
    'repeated_ambiguity','client_request','logistics_payment','manual',
    'low_confidence_image','audio_unheard','media_unreadable','unlisted_number','email_reply',
    'assistant_stopped','ops_silenced','deletion_requested','not_answered','price_to_owner',
    'allowance_used','stock_asked','billing_lapsed','plan_limit'));

-- ── Who is billed ──────────────────────────────────────────────────────────
-- A workspace that signed itself up and is not exempt. A practice copy
-- answers as its workspace. The pilots — made by the operator — never are.
create or replace function billed_workspace(p_business uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select p.id from businesses me join businesses p on p.id = coalesce(me.practice_of, me.id)
   where me.id = p_business and p.signed_up_at is not null
     and not exists (select 1 from workspace_billing w where w.business_id = p.id and w.exempt_by is not null)
$$;
revoke all on function billed_workspace(uuid) from public;

-- The first channel ever connected: the trial's clock (any state since).
create or replace function first_channel_at(p_business uuid) returns timestamptz
language sql stable security definer set search_path = public as $$
  select least(
    (select min(connected_at) from channels where business_id = p_business and kind = 'whatsapp'),
    (select min(connected_at) from meta_accounts where business_id = p_business),
    (select min(connected_at) from mail_accounts where business_id = p_business))
$$;
revoke all on function first_channel_at(uuid) from public;

-- ── What the app may ask, for the CURRENT business ─────────────────────────
-- The hold: the payment lapsed. Never on a pilot.
create or replace function billing_held() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select w.status = 'lapsed' from workspace_billing w
                    where w.business_id = billed_workspace(current_business_id())), false)
$$;
revoke all on function billing_held() from public;
grant execute on function billing_held() to nomi_app;

-- A plan's month used: this customer is not yet counted this month, and the
-- month already holds as many as the plan allows. Only a billed workspace on a
-- plan; never a practice copy (its customer is never counted).
create or replace function plan_limit_reached(p_conversation uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select (select count(*) from customers_answered a where a.business_id = w.business_id
             and a.month = date_trunc('month', now() at time zone 'UTC')::date) >= pl.customers_a_month
       and not exists (select 1 from customers_answered a join conversations c on c.client_id = a.client_id
                        where a.business_id = w.business_id and c.id = p_conversation
                          and a.month = date_trunc('month', now() at time zone 'UTC')::date)
      from workspace_billing w join plans pl on pl.id = w.plan_id
      join businesses me on me.id = current_business_id() and me.practice_of is null
     where w.business_id = billed_workspace(current_business_id())
       and w.status in ('trial', 'active', 'past_due')), false)
$$;
revoke all on function plan_limit_reached(uuid) from public;
grant execute on function plan_limit_reached(uuid) to nomi_app;

-- Card upfront: while the installation's switch is on, a billed workspace
-- connects a channel only once a card is saved.
create or replace function billing_card_needed() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from ops_flags where flag = 'billing_required' and cleared_at is null)
     and billed_workspace(current_business_id()) = current_business_id()
     and not exists (select 1 from workspace_billing w where w.business_id = current_business_id() and w.card_saved_at is not null)
$$;
revoke all on function billing_card_needed() from public;
grant execute on function billing_card_needed() to nomi_app;

-- Everything the billing page and the gates need, in one read.
create or replace function billing_state()
returns table (billed boolean, exempt boolean, plan_id text, status text, card_saved_at timestamptz,
               trial_days integer, trial_started_at timestamptz, trial_ends_at timestamptz,
               current_period_end timestamptz, has_customer boolean, customers_this_month integer,
               first_channel_at timestamptz, self_serve_trial_days integer)
language sql stable security definer set search_path = public as $$
  select billed_workspace(current_business_id()) is not null,
         exists (select 1 from workspace_billing x where x.business_id = current_business_id() and x.exempt_by is not null),
         w.plan_id, coalesce(w.status, 'none'), w.card_saved_at,
         coalesce(w.trial_days, (select s.self_serve_trial_days from billing_settings s where s.id)),
         w.trial_started_at, w.trial_ends_at, w.current_period_end, w.stripe_customer_id is not null,
         (select count(*)::int from customers_answered a where a.business_id = current_business_id()
             and a.month = date_trunc('month', now() at time zone 'UTC')::date),
         first_channel_at(current_business_id()),
         (select s.self_serve_trial_days from billing_settings s where s.id)
    from (select current_business_id() as id) me
    left join workspace_billing w on w.business_id = me.id
$$;
revoke all on function billing_state() from public;
grant execute on function billing_state() to nomi_app;

-- The plans on offer, for the page.
create or replace function plans_on_offer()
returns table (id text, name text, amount_minor integer, currency text, period text,
               customers_a_month integer, seats integer, assistants integer, stripe_price_id text)
language sql stable security definer set search_path = public as $$
  select id, name, amount_minor, currency, period, customers_a_month, seats, assistants, stripe_price_id
    from plans where active order by position, amount_minor, id
$$;
revoke all on function plans_on_offer() from public;
grant execute on function plans_on_offer() to nomi_app;

-- The limits that bind adding a person or an assistant (null: none).
create or replace function plan_limits() returns table (seats integer, assistants integer)
language sql stable security definer set search_path = public as $$
  select pl.seats, pl.assistants from workspace_billing w join plans pl on pl.id = w.plan_id
   where w.business_id = billed_workspace(current_business_id())
$$;
revoke all on function plan_limits() from public;
grant execute on function plan_limits() to nomi_app;

-- The owner chose a plan and is about to save a card: the row, the plan,
-- and — once trials are self-serve — the installation's trial.
create or replace function billing_choose(p_plan text) returns text
language plpgsql volatile security definer set search_path = public as $$
declare v_business uuid := current_business_id();
begin
  if billed_workspace(v_business) is distinct from v_business then return 'not_billed'; end if;
  if not exists (select 1 from plans where id = p_plan and active) then return 'no_plan'; end if;
  insert into workspace_billing as w (business_id, plan_id, trial_days, trial_granted_by, trial_granted_at)
  select v_business, p_plan, s.self_serve_trial_days,
         case when s.self_serve_trial_days is null then null else 'self-serve' end,
         case when s.self_serve_trial_days is null then null else now() end
    from billing_settings s where s.id
  on conflict (business_id) do update set plan_id = excluded.plan_id, updated_at = now()
    where w.stripe_subscription_id is null;
  return 'chosen';
end $$;
revoke all on function billing_choose(text) from public;
grant execute on function billing_choose(text) to nomi_app;

create or replace function billing_set_customer(p_customer text) returns void
language sql volatile security definer set search_path = public as $$
  update workspace_billing set stripe_customer_id = p_customer, updated_at = now()
   where business_id = current_business_id() and stripe_customer_id is null
$$;
revoke all on function billing_set_customer(text) from public;
grant execute on function billing_set_customer(text) to nomi_app;

-- ── What only Stripe's word may change (the webhook, the sweep) ────────────
create or replace function billing_business_for_customer(p_customer text) returns uuid
language sql stable security definer set search_path = public as $$
  select business_id from workspace_billing where stripe_customer_id = p_customer
$$;
revoke all on function billing_business_for_customer(text) from public;
grant execute on function billing_business_for_customer(text) to nomi_app;

-- An event handled once: true the first time its id is seen.
create or replace function claim_stripe_event(p_id text, p_type text, p_business uuid) returns boolean
language sql volatile security definer set search_path = public as $$
  with i as (insert into stripe_events (id, type, business_id) values (p_id, p_type, p_business)
             on conflict (id) do nothing returning 1)
  select exists (select 1 from i)
$$;
revoke all on function claim_stripe_event(text, text, uuid) from public;
grant execute on function claim_stripe_event(text, text, uuid) to nomi_app;

create or replace function billing_card_saved(p_business uuid, p_customer text) returns boolean
language sql volatile security definer set search_path = public as $$
  with u as (update workspace_billing set card_saved_at = coalesce(card_saved_at, now()), updated_at = now()
              where business_id = p_business and stripe_customer_id = p_customer returning 1)
  select exists (select 1 from u)
$$;
revoke all on function billing_card_saved(uuid, text) from public;
grant execute on function billing_card_saved(uuid, text) to nomi_app;

-- Stripe's word on the subscription: its id, our status, the period, the plan
-- by its price. Moving into 'lapsed' stamps when; leaving it clears the stamp
-- and the told mark, so a later lapse is told again.
create or replace function billing_subscription(p_customer text, p_subscription text, p_status text,
                                                p_period_end timestamptz, p_trial_end timestamptz, p_price text)
returns uuid
language sql volatile security definer set search_path = public as $$
  update workspace_billing w set
    stripe_subscription_id = p_subscription,
    status = p_status,
    current_period_end = p_period_end,
    trial_ends_at = coalesce(p_trial_end, w.trial_ends_at),
    plan_id = coalesce((select id from plans where stripe_price_id = p_price), w.plan_id),
    lapsed_at = case when p_status = 'lapsed' then coalesce(w.lapsed_at, now()) else null end,
    told_lapsed_at = case when p_status = 'lapsed' then w.told_lapsed_at else null end,
    updated_at = now()
   where w.stripe_customer_id = p_customer
  returning w.business_id
$$;
revoke all on function billing_subscription(text, text, text, timestamptz, timestamptz, text) from public;
grant execute on function billing_subscription(text, text, text, timestamptz, timestamptz, text) to nomi_app;

create or replace function billing_payment_failed(p_customer text) returns uuid
language sql volatile security definer set search_path = public as $$
  update workspace_billing set told_payment_failed_at = null, updated_at = now()
   where stripe_customer_id = p_customer returning business_id
$$;
revoke all on function billing_payment_failed(text) from public;
grant execute on function billing_payment_failed(text) to nomi_app;

-- The sweep: a card saved, a plan chosen, a channel connected, no subscription
-- yet — the moment to make one, its trial ending where the clock says.
create or replace function billing_to_subscribe()
returns table (business_id uuid, customer text, price text, trial_days integer, first_channel_at timestamptz)
language sql stable security definer set search_path = public as $$
  select w.business_id, w.stripe_customer_id, pl.stripe_price_id, w.trial_days, first_channel_at(w.business_id)
    from workspace_billing w join plans pl on pl.id = w.plan_id
   where w.card_saved_at is not null and w.stripe_customer_id is not null and w.stripe_subscription_id is null
     and w.exempt_by is null and first_channel_at(w.business_id) is not null
$$;
revoke all on function billing_to_subscribe() from public;
grant execute on function billing_to_subscribe() to nomi_app;

create or replace function billing_subscribed(p_business uuid, p_subscription text, p_status text,
                                              p_trial_started timestamptz, p_trial_end timestamptz, p_period_end timestamptz)
returns void
language sql volatile security definer set search_path = public as $$
  update workspace_billing set stripe_subscription_id = p_subscription, status = p_status,
         trial_started_at = case when p_trial_end is null then null else p_trial_started end,
         trial_ends_at = p_trial_end, current_period_end = p_period_end, updated_at = now()
   where business_id = p_business and stripe_subscription_id is null
$$;
revoke all on function billing_subscribed(uuid, text, text, timestamptz, timestamptz, timestamptz) from public;
grant execute on function billing_subscribed(uuid, text, text, timestamptz, timestamptz, timestamptz) to nomi_app;

-- The owner's e-mails, each once: the trial ending (three days before), a
-- payment failed, the hold. A plan's month used is told once a month.
alter table workspace_billing add column if not exists told_plan_limit_month date;
create or replace function claim_billing_alerts() returns table (business_id uuid, kind text, at timestamptz)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
begin
  return query
  with ending as (
    update workspace_billing w set told_trial_ending_at = now()
     where w.status = 'trial' and w.trial_ends_at is not null and w.told_trial_ending_at is null
       and w.trial_ends_at <= now() + interval '3 days' and w.exempt_by is null
    returning w.business_id, 'billing_trial_ending'::text, w.trial_ends_at),
  failed as (
    update workspace_billing w set told_payment_failed_at = now()
     where w.status = 'past_due' and w.told_payment_failed_at is null and w.exempt_by is null
    returning w.business_id, 'billing_payment_failed'::text, w.current_period_end),
  lapsed as (
    update workspace_billing w set told_lapsed_at = now()
     where w.status = 'lapsed' and w.told_lapsed_at is null and w.exempt_by is null
    returning w.business_id, 'billing_lapsed'::text, w.lapsed_at),
  month_used as (
    update workspace_billing w set told_plan_limit_month = date_trunc('month', now() at time zone 'UTC')::date
      from plans pl
     where pl.id = w.plan_id and w.exempt_by is null and w.status in ('trial', 'active', 'past_due')
       and w.told_plan_limit_month is distinct from date_trunc('month', now() at time zone 'UTC')::date
       and (select count(*) from customers_answered a where a.business_id = w.business_id
             and a.month = date_trunc('month', now() at time zone 'UTC')::date) >= pl.customers_a_month
    returning w.business_id, 'plan_limit'::text, now())
  select * from ending union all select * from failed union all select * from lapsed union all select * from month_used;
end $$;
revoke all on function claim_billing_alerts() from public;
grant execute on function claim_billing_alerts() to nomi_app;

insert into _migrations (version, name) values (117, 'billing')
on conflict (version) do nothing;
