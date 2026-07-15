-- =============================================================================
-- 0004 — The commercial schema: what "negotiate within business rules" runs on
--
-- products.price_usd_per_unit is a single scalar. You cannot negotiate with one
-- number, and there were no rules to negotiate within — so the model improvised,
-- which is the hallucinated-price problem by another name. (ADR-0006)
--
-- Every number the AI sends a customer originates in these tables.
-- =============================================================================

-- Volume price breaks. [min_qty, max_qty]; max_qty null = unbounded.
create table if not exists price_tiers (
  product_id      uuid not null references products(id) on delete cascade,
  min_qty         integer not null check (min_qty > 0),
  max_qty         integer check (max_qty is null or max_qty >= min_qty),
  unit_price_usd  numeric(10,4) not null check (unit_price_usd > 0),
  primary key (product_id, min_qty)
);

-- The guardrail the AI may never cross. Enforced in code (core/commerce/quote.ts):
-- no prompt, however injected, can quote below floor_price_usd, because the
-- language model is never the thing deciding the price.
create table if not exists pricing_policy (
  id                        uuid primary key default gen_random_uuid(),
  business_id               uuid not null references businesses(id) on delete cascade,
  product_id                uuid references products(id) on delete cascade,  -- null = business default
  floor_price_usd           numeric(10,4) not null check (floor_price_usd > 0),
  max_discount_pct          numeric(5,2) not null default 0
                              check (max_discount_pct between 0 and 100),
  human_required_above_pct  numeric(5,2) not null default 0
                              check (human_required_above_pct between 0 and 100),
  unique (business_id, product_id)
);

-- "3% off above 10,000 units." Deterministic, priority-ordered, auditable.
create table if not exists negotiation_rules (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  priority     integer not null default 100,
  condition    jsonb not null,   -- {"qtyGte": 10000, "productId": "..."}
  action       jsonb not null,   -- {"kind": "discount_pct", "value": 3}
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

create index if not exists idx_negotiation_rules_business
  on negotiation_rules (business_id, priority) where is_active;

-- "Buy A + B together, get C." Cross-sell without the LLM inventing offers.
create table if not exists bundle_rules (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  name         text not null,
  requires     uuid[] not null,  -- product ids that must all be in the inquiry
  grants       jsonb not null,   -- RuleAction
  is_active    boolean not null default true
);

-- "Below MOQ / out of stock → offer this instead." Drives recommendation.
create table if not exists substitution_rules (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references businesses(id) on delete cascade,
  product_id     uuid not null references products(id) on delete cascade,
  substitute_id  uuid not null references products(id) on delete cascade,
  reason         text not null check (reason in
                   ('below_moq','out_of_stock','cheaper','upsell')),
  rank           integer not null default 1,
  check (product_id <> substitute_id)
);

create index if not exists idx_substitutions_product
  on substitution_rules (product_id, rank);

-- Seed price_tiers from the existing scalar price so the quote engine works on
-- day one. The scalar column stays (n8n reads it) until the contract migration.
insert into price_tiers (product_id, min_qty, max_qty, unit_price_usd)
select id, greatest(moq, 1), null, price_usd_per_unit
  from products
 where price_usd_per_unit is not null
on conflict (product_id, min_qty) do nothing;

insert into _migrations (version, name) values (4, 'commercial_schema')
on conflict (version) do nothing;
