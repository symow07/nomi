-- ---------------------------------------------------------------------------
-- 0240 — 4.1: THE TRIAL'S END, WIRED TO `billing_required`.
--
-- What already held (0117, D4): a subscription Stripe gave up on is `lapsed`,
-- and a lapsed workspace is frozen (`billing_held()`), the owner told once.
-- A card saved before the first channel (card up front) reaches that path at
-- the trial's end on its own: Stripe charges it, retries, and gives up.
--
-- What did not: a workspace with NO card. While the installation's switch
-- `billing_required` is on (or the sign-up scored medium: a card whatever the
-- switch says, 0148), no channel connects without a card — but a workspace
-- that connected before the switch went on, or while it was off, has a
-- channel and no card, so no subscription is ever made and its trial never
-- ends: it was answered for nothing, for ever.
--
-- Now: while a card is needed (the same two conditions as
-- `billing_card_needed()`), a billed workspace with no card saved whose trial
-- is over — the first channel connected plus the trial it would start with
-- (`trial_days_for`; none on request means none) — is held exactly as a lapse
-- is: `billing_held()` answers true, so everything D4 freezes, freezes. Saving
-- a card lifts it at once; the sweep then makes the subscription, charged now
-- (its trial already over, `trialEndFrom`). Clearing the switch lifts it too.
--
-- The owner is told once, by its own alert (`billing_trial_over`), marked on
-- `workspace_billing.told_trial_over_at` — a row the workspace may not have
-- yet (it is made when a plan is chosen), so the claim makes it.
--
-- `billing_hold_reason()` says which hold it is ('lapsed' | 'trial_over'),
-- so the pages say why in true words: the subscription has not ended, there
-- never was one.
--
-- Forward-only (ADR-0007). Every function keeps its name and arguments.
-- ---------------------------------------------------------------------------

alter table workspace_billing add column if not exists told_trial_over_at timestamptz;

-- The trial is over and no card is saved, while one is needed. For the
-- workspace that pays (never a pilot, never an exempt one; a practice copy is
-- asked about its workspace by the callers below).
create or replace function billing_trial_over(p_business uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select billed_workspace(p_business) = p_business
     and (exists (select 1 from ops_flags where flag = 'billing_required' and cleared_at is null)
          or exists (select 1 from signup_risk r where r.business_id = p_business and r.tier = 'medium'))
     and not exists (select 1 from workspace_billing w where w.business_id = p_business and w.card_saved_at is not null)
     and coalesce(first_channel_at(p_business) + make_interval(days => coalesce(trial_days_for(p_business), 0)) <= now(), false)
$$;
revoke all on function billing_trial_over(uuid) from public;

-- Which hold, for the CURRENT business (a practice copy answers as its workspace): null when none.
create or replace function billing_hold_reason() returns text
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from workspace_billing w where w.business_id = billed_workspace(current_business_id()) and w.status = 'lapsed') then 'lapsed'
    when billed_workspace(current_business_id()) is not null and billing_trial_over(billed_workspace(current_business_id())) then 'trial_over'
  end
$$;
revoke all on function billing_hold_reason() from public;
grant execute on function billing_hold_reason() to nomi_app;

-- Re-made from 0117's, with the trial's end: the one question every frozen thing asks.
create or replace function billing_held() returns boolean
language sql stable security definer set search_path = public as $$
  select billing_hold_reason() is not null
$$;
revoke all on function billing_held() from public;
grant execute on function billing_held() to nomi_app;

-- Re-made from 0117's, with the trial's end told once (`billing_trial_over`).
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
    returning w.business_id, 'plan_limit'::text, now()),
  trial_over as (
    insert into workspace_billing as w (business_id, told_trial_over_at)
    select b.id, now() from businesses b
     where b.signed_up_at is not null and b.practice_of is null and b.is_active and billing_trial_over(b.id)
    on conflict (business_id) do update set told_trial_over_at = now(), updated_at = now()
      where w.told_trial_over_at is null
    returning w.business_id, 'billing_trial_over'::text, now())
  select * from ending union all select * from failed union all select * from lapsed union all select * from month_used
  union all select * from trial_over;
end $$;
revoke all on function claim_billing_alerts() from public;
grant execute on function claim_billing_alerts() to nomi_app;

-- The installation's switch, for the public site's pricing section (no workspace to ask about): "card up front"
-- is said there only while it is true.
create or replace function billing_required_on() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from ops_flags where flag = 'billing_required' and business_id is null and cleared_at is null)
$$;
revoke all on function billing_required_on() from public;
grant execute on function billing_required_on() to nomi_app;

insert into _migrations (version, name) values (240, 'trial_end_hold')
  on conflict (version) do nothing;
