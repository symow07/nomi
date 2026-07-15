-- =============================================================================
-- 0005 — Tenant plumbing (RLS by session variable) + shadow schema + events
-- =============================================================================

-- ---------------------------------------------------------------------------
-- (a) The app role. The service NEVER connects as service_role (BYPASSRLS).
--     RLS that the application can bypass is decoration. (ADR-0005)
--     NOTE: role creation may require running as the postgres superuser once.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select from pg_roles where rolname = 'yiwuflow_app') then
    create role yiwuflow_app nologin;  -- LOGIN granted per-environment, password set out-of-band
  end if;
end $$;

grant usage on schema public to yiwuflow_app;
grant select, insert, update on all tables in schema public to yiwuflow_app;
grant usage on all sequences in schema public to yiwuflow_app;
alter default privileges in schema public
  grant select, insert, update on tables to yiwuflow_app;
-- Deliberately NO DELETE: this system archives and cancels; it does not erase.

-- ---------------------------------------------------------------------------
-- (b) Tenant-scoped policies keyed to a transaction-local session variable.
--     withTenant() runs: set_config('app.business_id', $1, true)  -- SET LOCAL
--     A query that forgets its WHERE clause now returns zero rows, not another
--     customer's order book.
-- ---------------------------------------------------------------------------
create or replace function current_business_id() returns uuid
language sql stable as
$$ select nullif(current_setting('app.business_id', true), '')::uuid $$;

-- Tables with a business_id column get the direct policy.
do $$
declare t text;
begin
  foreach t in array array[
    'businesses','channel_sources','products','clients','conversations',
    'orders','escalation_events','conversation_signals','deliveries',
    'pricing_policy','negotiation_rules','bundle_rules','substitution_rules'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format($p$
      drop policy if exists tenant_isolation_app on %I;
      create policy tenant_isolation_app on %I
        for all to yiwuflow_app
        using      (%s = current_business_id())
        with check (%s = current_business_id())
    $p$, t, t,
      case when t = 'businesses' then 'id' else 'business_id' end,
      case when t = 'businesses' then 'id' else 'business_id' end);
  end loop;
end $$;

-- Tables reachable only through a parent FK join to the tenant.
alter table conversation_state enable row level security;
drop policy if exists tenant_isolation_app on conversation_state;
create policy tenant_isolation_app on conversation_state
  for all to yiwuflow_app
  using (exists (select 1 from conversations c
                  where c.id = conversation_state.conversation_id
                    and c.business_id = current_business_id()))
  with check (exists (select 1 from conversations c
                  where c.id = conversation_state.conversation_id
                    and c.business_id = current_business_id()));

alter table messages enable row level security;
drop policy if exists tenant_isolation_app on messages;
create policy tenant_isolation_app on messages
  for all to yiwuflow_app
  using (exists (select 1 from conversations c
                  where c.id = messages.conversation_id
                    and c.business_id = current_business_id()))
  with check (exists (select 1 from conversations c
                  where c.id = messages.conversation_id
                    and c.business_id = current_business_id()));

alter table client_channels enable row level security;
drop policy if exists tenant_isolation_app on client_channels;
create policy tenant_isolation_app on client_channels
  for all to yiwuflow_app
  using (exists (select 1 from clients cl
                  where cl.id = client_channels.client_id
                    and cl.business_id = current_business_id()))
  with check (exists (select 1 from clients cl
                  where cl.id = client_channels.client_id
                    and cl.business_id = current_business_id()));

alter table price_tiers enable row level security;
drop policy if exists tenant_isolation_app on price_tiers;
create policy tenant_isolation_app on price_tiers
  for all to yiwuflow_app
  using (exists (select 1 from products p
                  where p.id = price_tiers.product_id
                    and p.business_id = current_business_id()))
  with check (exists (select 1 from products p
                  where p.id = price_tiers.product_id
                    and p.business_id = current_business_id()));

alter table product_aliases enable row level security;
drop policy if exists tenant_isolation_app on product_aliases;
create policy tenant_isolation_app on product_aliases
  for all to yiwuflow_app
  using (exists (select 1 from products p
                  where p.id = product_aliases.product_id
                    and p.business_id = current_business_id()));

alter table product_images enable row level security;
drop policy if exists tenant_isolation_app on product_images;
create policy tenant_isolation_app on product_images
  for all to yiwuflow_app
  using (exists (select 1 from products p
                  where p.id = product_images.product_id
                    and p.business_id = current_business_id()));

alter table email_confirmations enable row level security;
drop policy if exists tenant_isolation_app on email_confirmations;
create policy tenant_isolation_app on email_confirmations
  for all to yiwuflow_app
  using (exists (select 1 from orders o
                  where o.id = email_confirmations.order_id
                    and o.business_id = current_business_id()));

-- ---------------------------------------------------------------------------
-- (c) Channel credentials: the tenant is derived from the credential the
--     message arrived on — NEVER from the payload. business_id disappears from
--     the inbound message schema entirely; it cannot be spoofed if it does not
--     exist. secret_ref points into an external secret store: a database backup
--     must never be a credential dump. (ADR-0005 §4–5)
-- ---------------------------------------------------------------------------
create table if not exists channel_credentials (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id) on delete cascade,
  channel       text not null check (channel in
                  ('whatsapp','wechat','instagram','rednote','telegram',
                   'webhook_test','email','web_widget')),
  external_ref  text not null,   -- WABA phone_number_id / IG page id / webhook token id
  secret_ref    text not null,   -- pointer into the secret store — NOT the secret
  engine        text not null default 'n8n' check (engine in ('n8n','service')),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (channel, external_ref)
);

alter table channel_credentials enable row level security;
drop policy if exists tenant_isolation_app on channel_credentials;
create policy tenant_isolation_app on channel_credentials
  for all to yiwuflow_app
  using (business_id = current_business_id())
  with check (business_id = current_business_id());

-- Tenant resolution happens BEFORE app.business_id can be set, so the lookup
-- runs as a narrowly-scoped definer function rather than under the tenant policy.
create or replace function resolve_tenant(p_channel text, p_external_ref text)
returns table (business_id uuid, credential_id uuid, engine text)
language sql stable security definer set search_path = public as $$
  select business_id, id, engine
    from channel_credentials
   where channel = p_channel and external_ref = p_external_ref and is_active
   limit 1
$$;
revoke all on function resolve_tenant(text, text) from public;
grant execute on function resolve_tenant(text, text) to yiwuflow_app;

-- Per-business engine flag: THE rollback mechanism. Cutover and rollback are
-- `update businesses set engine = ...` — no deploy. (ADR-0009)
alter table businesses
  add column if not exists engine text not null default 'n8n'
    check (engine in ('n8n','service'));

-- ---------------------------------------------------------------------------
-- (d) Shadow schema: where the service records what it WOULD have done while
--     n8n remains authoritative. Decisions only — never prose. (ADR-0009)
-- ---------------------------------------------------------------------------
create schema if not exists shadow;
grant usage on schema shadow to yiwuflow_app;

create table if not exists shadow.turn_decisions (
  message_id       text primary key,
  conversation_id  uuid,
  business_id      uuid,
  n8n_decision     jsonb,            -- filled by the diff job from canonical tables
  svc_decision     jsonb not null,   -- what the service would have done
  diverged         boolean,
  divergences      text[],           -- ['phase','lead_score']
  expected         boolean not null default false,  -- known intentional divergence
  created_at       timestamptz not null default now()
);
grant select, insert, update on shadow.turn_decisions to yiwuflow_app;

-- ---------------------------------------------------------------------------
-- (e) Analytics event log. Append-only; funnels cannot be reconstructed from
--     state you did not record. (ADR-0001 §5.8)
-- ---------------------------------------------------------------------------
create table if not exists conversation_events (
  id               bigint generated always as identity primary key,
  business_id      uuid not null,
  conversation_id  uuid not null,
  type             text not null,   -- message_in, product_matched, quote_sent,
                                    -- objection, lead_hot, handoff, order_created, ...
  payload          jsonb not null default '{}',
  created_at       timestamptz not null default now()
);

create index if not exists idx_events_business_time
  on conversation_events (business_id, created_at);
create index if not exists idx_events_conversation
  on conversation_events (conversation_id, id);

alter table conversation_events enable row level security;
drop policy if exists tenant_isolation_app on conversation_events;
create policy tenant_isolation_app on conversation_events
  for all to yiwuflow_app
  using (business_id = current_business_id())
  with check (business_id = current_business_id());

insert into _migrations (version, name) values (5, 'tenancy_and_shadow')
on conflict (version) do nothing;
