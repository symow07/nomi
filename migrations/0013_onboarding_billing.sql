-- =============================================================================
-- 0013 — M6: onboarding state (one row per business, resumable, activation
-- instrumented), subscriptions + manually confirmed payments. Additive only.
-- =============================================================================

create table if not exists onboarding_state (
  business_id             uuid primary key references businesses(id) on delete cascade,
  step                    text not null default 'name_employee' check (step in
                            ('name_employee','business_basics','catalog_import',
                             'connect_whatsapp','first_conversation','done')),
  employee_name           text,
  avatar                  text,
  signup_at               timestamptz not null default now(),
  products_imported       integer not null default 0,
  whatsapp_connected      boolean not null default false,
  first_draft_approved_at timestamptz,          -- THE activation metric
  updated_at              timestamptz not null default now()
);

create table if not exists subscriptions (
  business_id    uuid primary key references businesses(id) on delete cascade,
  plan_id        text not null default 'trial' check (plan_id in ('trial','standard','pro')),
  status         text not null default 'trialing' check (status in
                   ('trialing','active','past_due','canceled')),
  started_at     timestamptz not null default now(),
  trial_ends_at  timestamptz,
  paid_through   timestamptz,
  updated_at     timestamptz not null default now()
);

-- Manual invoicing by design: a human confirms the WeChat/Alipay/bank payment
-- and records it here; confirm_payment() arithmetic lives in core/billing.
create table if not exists payments (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id) on delete cascade,
  amount_cny    numeric(10,2) not null check (amount_cny > 0),
  method        text not null check (method in ('wechat','alipay','bank')),
  reference     text,                            -- transfer slip / transaction id
  fapiao_status text not null default 'none' check (fapiao_status in
                  ('none','requested','issued')),
  confirmed_by  text,
  confirmed_at  timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists idx_payments_biz on payments (business_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['onboarding_state','subscriptions','payments'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists tenant_isolation_app on %I', t);
    execute format(
      'create policy tenant_isolation_app on %I for all to yiwuflow_app using (business_id = current_business_id()) with check (business_id = current_business_id())', t);
  end loop;
end $$;

insert into _migrations (version, name) values (13, 'onboarding_billing')
on conflict (version) do nothing;
