-- 0030 — M43a: money becomes a pair.
--
-- Every price in this product was a bare number whose currency lived in the
-- COLUMN NAME. That is a comment, and comments do not participate in
-- arithmetic: on the day a second currency exists, a euro amount added to a
-- dollar floor computes cleanly and reaches a buyer as a quote.
--
-- So the currency moves into the row, beside the amount.
--
-- ADDITIVE AND FORWARD-ONLY. The amount columns keep their historical names —
-- `unit_price_usd` alongside a `currency` column reads oddly, and it is still
-- the right trade: renaming them would rewrite four tables, invalidate every
-- snapshot in `quotes.inputs`, and break any deploy running the previous build
-- for the seconds between migrate and swap. The name is now history, like
-- every other name in this schema that outlived its meaning; the CODE is what
-- had to stop lying, and it has (core/types/money.ts).
--
-- USD IS STILL THE ONLY CURRENCY, and the check constraint says so. This
-- milestone changes no behaviour: it changes where the currency is written
-- down. Adding a member to that constraint is a promise that every conversion
-- has an owner-stated rate behind it (M43b) — a row the code cannot price must
-- not be insertable, which is why the constraint is an allow-list rather than
-- a comment.

-- The four tables whose amounts are read back into `Money`.
alter table price_tiers
  add column if not exists currency text not null default 'USD';
alter table pricing_policy
  add column if not exists currency text not null default 'USD';
alter table quotes
  add column if not exists currency text not null default 'USD';
alter table orders
  add column if not exists currency text not null default 'USD';

-- products.price_usd_per_unit is the catalogue's own scalar, and it is read
-- into Money by the import and product surfaces.
alter table products
  add column if not exists currency text not null default 'USD';

-- The allow-list. A currency the code cannot price cannot be stored, so a
-- misconfigured import fails at the write rather than at the quote.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'price_tiers_currency_known') then
    alter table price_tiers add constraint price_tiers_currency_known check (currency in ('USD'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pricing_policy_currency_known') then
    alter table pricing_policy add constraint pricing_policy_currency_known check (currency in ('USD'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quotes_currency_known') then
    alter table quotes add constraint quotes_currency_known check (currency in ('USD'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_currency_known') then
    alter table orders add constraint orders_currency_known check (currency in ('USD'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'products_currency_known') then
    alter table products add constraint products_currency_known check (currency in ('USD'));
  end if;
end $$;

insert into _migrations (version, name) values (30, 'money_currency')
on conflict (version) do nothing;
