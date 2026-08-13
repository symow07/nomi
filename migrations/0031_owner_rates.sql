-- 0031 — M43b: the rate SHE stated.
--
-- A buyer pays dollars; a Yiwu owner thinks in ￥. Something has to convert,
-- and the obvious way is to fetch today's rate — which is exactly the thing
-- this product exists not to do. A live rate is not wrong the way a
-- hallucinated price is wrong. It is worse, because it is ACCURATE: right to
-- four decimals, moving while she sleeps, turning a figure she once agreed to
-- into one she never saw.
--
-- So the rate is a row she wrote, with the date she wrote it, and nothing
-- converts without one.
--
-- HISTORY, NOT STATE. Rates are never updated in place and never deleted:
-- stating a new one inserts a new row, and the most recent per pair is what
-- she will honour. A quote she gave in March was converted at March's rate,
-- and the row that did it is still here to say so.

create table if not exists owner_rates (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references businesses(id) on delete cascade,
  from_currency  text not null,
  to_currency    text not null,
  -- How many units of `to` she will honour for one unit of `from`.
  rate           numeric(18,6) not null check (rate > 0),
  -- The date SHE set it. Shown wherever a converted figure appears, because
  -- staleness is her judgement to make and she cannot make it unseen.
  stated_at      timestamptz not null default now(),
  stated_by      text not null default 'owner',
  created_at     timestamptz not null default now(),
  constraint owner_rates_currencies_known
    check (from_currency in ('USD','CNY') and to_currency in ('USD','CNY')),
  -- A rate from a currency to itself is not a rate; it is the identity, and
  -- `convertMoney` handles it without a row.
  constraint owner_rates_not_identity check (from_currency <> to_currency)
);

create index if not exists owner_rates_lookup
  on owner_rates (business_id, from_currency, to_currency, stated_at desc);

alter table owner_rates enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'owner_rates' and policyname = 'owner_rates_tenant') then
    create policy owner_rates_tenant on owner_rates
      for all to nomi_app
      using (business_id = current_business_id())
      with check (business_id = current_business_id());
  end if;
end $$;

-- INSERT-ONLY HISTORY, enforced by privilege rather than by convention.
-- The schema's default privileges grant UPDATE on every new table, so a rate
-- COULD be edited in place — and an edited rate is a quote that silently
-- changes value after it was given. Revoked here, deliberately and narrowly:
-- stating a new rate inserts a new row, which is the only way this table
-- changes. (No DELETE: the app role has none anywhere, by design.)
grant select, insert on owner_rates to nomi_app;
revoke update on owner_rates from nomi_app;

insert into _migrations (version, name)
values (31, 'owner_rates')
on conflict (version) do nothing;
