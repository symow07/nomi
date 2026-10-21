-- ---------------------------------------------------------------------------
-- 0168 — MAD, EUR AND GBP (Phase 5, A1: the books need the dirham, the euro and the pound).
--
-- The nine currency checks of 0092 and 0094 widen from the first list (USD, CNY, AED, SAR, BRL, MXN, INR, IDR) to
-- it plus the Moroccan dirham, the euro and the pound sterling. Nothing else changes: no column, no row, no rate.
-- A workspace still sells in ONE currency (businesses.currency) and nothing converts except at a rate the owner
-- stated (owner_rates). The minor units of all eleven are two (ISO 4217), which the columns already hold.
--
-- Every check keeps its name; each is dropped and added again in this one transaction.
-- ---------------------------------------------------------------------------

alter table businesses     drop constraint businesses_currency_known,
                           add constraint businesses_currency_known check (currency in ('USD', 'CNY', 'AED', 'SAR', 'BRL', 'MXN', 'INR', 'IDR', 'MAD', 'EUR', 'GBP'));
alter table products       drop constraint products_currency_known,
                           add constraint products_currency_known check (currency in ('USD', 'CNY', 'AED', 'SAR', 'BRL', 'MXN', 'INR', 'IDR', 'MAD', 'EUR', 'GBP'));
alter table price_tiers    drop constraint price_tiers_currency_known,
                           add constraint price_tiers_currency_known check (currency in ('USD', 'CNY', 'AED', 'SAR', 'BRL', 'MXN', 'INR', 'IDR', 'MAD', 'EUR', 'GBP'));
alter table pricing_policy drop constraint pricing_policy_currency_known,
                           add constraint pricing_policy_currency_known check (currency in ('USD', 'CNY', 'AED', 'SAR', 'BRL', 'MXN', 'INR', 'IDR', 'MAD', 'EUR', 'GBP'));
alter table quotes         drop constraint quotes_currency_known,
                           add constraint quotes_currency_known check (currency in ('USD', 'CNY', 'AED', 'SAR', 'BRL', 'MXN', 'INR', 'IDR', 'MAD', 'EUR', 'GBP'));
alter table orders         drop constraint orders_currency_known,
                           add constraint orders_currency_known check (currency in ('USD', 'CNY', 'AED', 'SAR', 'BRL', 'MXN', 'INR', 'IDR', 'MAD', 'EUR', 'GBP'));
alter table sample_policy  drop constraint sample_policy_currency_known,
                           add constraint sample_policy_currency_known check (currency in ('USD', 'CNY', 'AED', 'SAR', 'BRL', 'MXN', 'INR', 'IDR', 'MAD', 'EUR', 'GBP'));
alter table owner_rates    drop constraint owner_rates_currencies_known,
                           add constraint owner_rates_currencies_known
                             check (from_currency in ('USD', 'CNY', 'AED', 'SAR', 'BRL', 'MXN', 'INR', 'IDR', 'MAD', 'EUR', 'GBP') and to_currency in ('USD', 'CNY', 'AED', 'SAR', 'BRL', 'MXN', 'INR', 'IDR', 'MAD', 'EUR', 'GBP'));
alter table catalog_imports drop constraint catalog_imports_currency_check,
                            add constraint catalog_imports_currency_check check (currency in ('USD', 'CNY', 'AED', 'SAR', 'BRL', 'MXN', 'INR', 'IDR', 'MAD', 'EUR', 'GBP'));

insert into _migrations (version, name) values (168, 'more_currencies')
  on conflict (version) do nothing;
