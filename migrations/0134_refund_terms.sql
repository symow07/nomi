-- 0134 · the refund terms (docs/PRE-LAUNCH.md item 5): what the public page reads, and the one plan type it covers.
--
-- The refund page at /refunds describes MONTHLY subscriptions only — Nomi sells nothing else. A plan of another
-- period would be offered beside a link to terms that do not describe it, so no such plan can be put on offer:
-- `plans.period` must be 'month'. Selling yearly means new terms first, then a migration that lifts this.
--
-- The page draws its free-trial clause from the self-serve trial (`billing_settings.self_serve_trial_days`) and
-- leaves the clause out while none is set. The app role reads that one number through a definer function, as it
-- reads the plans; the table itself stays closed to it.
--
-- Forward-only (ADR-0007). An older build never offers a yearly plan through this table once it holds; it reads
-- nothing new.

alter table plans
  add constraint plans_monthly_only check (period = 'month');

create or replace function self_serve_trial_days() returns integer
language sql stable security definer set search_path = public as $$
  select self_serve_trial_days from billing_settings where id
$$;
revoke all on function self_serve_trial_days() from public;
grant execute on function self_serve_trial_days() to nomi_app;

insert into _migrations (version, name) values (134, 'refund_terms')
  on conflict (version) do nothing;
