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
  interval           text not null check (interval in ('month', 'year')),
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

insert into _migrations (version, name) values (117, 'billing')
on conflict (version) do nothing;
