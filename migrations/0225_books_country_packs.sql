-- ---------------------------------------------------------------------------
-- 0225 — COUNTRY PACKS FOR THE BOOKS: MOROCCO, THE UNITED KINGDOM, THE UNITED STATES (Block 2 PR 1; the owner's
-- decision of 2026-11-06 that all three are built).
--
-- One page under Books settings chooses the country and loads its pack: a chart of accounts, tax codes, the identifier
-- the country's books carry, and how long the records are kept. This migration gives it what the code cannot make up
-- at run time:
--
--   · `accounts.holds_money` — the chart says which accounts are a bank or a till. The Books audit (2026-11-05) found a
--     bank named "Barclays Current" was not recognised: `holdsMoney` (src/core/books/moneyAccounts.ts) reads the CGNC's
--     numbering and the word "bank" or "cash" in a name, and nothing else. Now the template marks it, the owner can
--     tick it, and the payment form offers either. Backfilled here by the same rules as the code's, for asset accounts
--     only (an expense called "Bank charges" holds nothing).
--   · `chart_template_accounts.holds_money`, copied by `apply_chart_template` (re-made below). The CGNC template's
--     514 (banks, the Trésorerie Générale, postal cheques) and 516 (cash) families are marked by UPDATE — 0190 is
--     applied and is never edited.
--   · Two plain charts, `uk-plain` (GB) and `us-plain` (US): Nomi's own, about forty accounts each, four-digit codes,
--     no law prescribes either; the owner renames what they like. The UK keeps a VAT control account; the US a sales
--     tax payable account and no VAT.
--   · `businesses.company_number` (Companies House: eight digits, or two capitals and six digits — R3's rule) and
--     `businesses.ein` (00-0000000), the identifiers the UK and US packs ask for. The Moroccan ICE, IF and RC are 0206's.
--   · `books_retention` gains the United States: seven years, Nomi's own choice — the period commonly cited for
--     federal tax record-keeping, counted as every row of that table is, from the end of the last financial year with
--     an entry. The privacy page's list (`BOOKS_RETENTION`) changes with it.
--
-- Nothing is filed with any authority. France, Spain and China stay RESEARCHED (docs/PHASE-5.md §1b).
-- ---------------------------------------------------------------------------

-- ── which accounts hold money ────────────────────────────────────────────────────────────────────────────────────────
alter table accounts add column if not exists holds_money boolean not null default false;
alter table chart_template_accounts add column if not exists holds_money boolean not null default false;

-- The CGNC's own numbering: 514 banks, the T.G. and postal cheques; 516 cash. 511 (cheques to be cashed) is neither.
update chart_template_accounts set holds_money = true where template = 'cgnc-normal' and code ~ '^51[46]';

-- The accounts already on record, by the code's rules (src/core/books/moneyAccounts.ts): the CGNC families, or the
-- word bank / cash in the languages the owner's pages use. Asset accounts only.
update accounts set holds_money = true
 where kind = 'asset' and not holds_money and (
   code ~ '^51[46]'
   or (lower(name) !~ 'bons? de caisse' and (
        lower(name) ~ '(^|[^[:alnum:]])(banks?|banques?|bancos?|cash|caisses?|cajas?|caixas?|kasse|kassen)($|[^[:alnum:]])'
        or name ~ '(银行|现金)'
        or name ~ '(^|[^[:alnum:]])(ال)?(بنك|مصرف|صندوق)($|[^[:alnum:]])')));

-- apply_chart_template, re-made from 0171: it copies the marker. Everything else is as it was.
create or replace function apply_chart_template(p_template text)
returns table (accounts_added integer, journals_added integer)
language plpgsql security invoker set search_path = public as $$
declare
  biz uuid := current_business_id();
  a integer;
  j integer;
  added text[];
begin
  if biz is null then
    raise exception 'books: a chart is applied inside a workspace' using errcode = 'NB013';
  end if;
  if not exists (select 1 from chart_templates where code = p_template) then
    raise exception 'books: there is no chart template "%"', p_template using errcode = 'NB013';
  end if;

  with ins as (
    insert into accounts (business_id, code, name, kind, holds_money)
    select biz, t.code, t.name, t.kind, t.holds_money from chart_template_accounts t
     where t.template = p_template
    on conflict (business_id, code) do nothing
    returning code
  ) select coalesce(array_agg(code), '{}') into added from ins;
  a := cardinality(added);

  -- Parents, by code — only for the accounts this call added: an existing account keeps its own place.
  update accounts c set parent_id = p.id
    from chart_template_accounts t
    join accounts p on p.business_id = biz and p.code = t.parent_code
   where c.business_id = biz and c.code = t.code and t.template = p_template
     and t.parent_code is not null and c.code = any(added);

  insert into journals (business_id, code, name, kind)
  select biz, t.code, t.name, t.kind from chart_template_journals t
   where t.template = p_template
  on conflict (business_id, code) do nothing;
  get diagnostics j = row_count;

  return query select a, j;
end $$;
revoke all on function apply_chart_template(text) from public;
grant execute on function apply_chart_template(text) to nomi_app;

-- ── the two plain charts ─────────────────────────────────────────────────────────────────────────────────────────────
insert into chart_templates (code, name, country, version, source) values
  ('uk-plain', 'Plain chart for a small business (United Kingdom)', 'GB', '2026-11',
   'Nomi''s own plain chart: no law prescribes one; a VAT control account; every account the owner''s to rename'),
  ('us-plain', 'Plain chart for a small business (United States)', 'US', '2026-11',
   'Nomi''s own plain chart: no law prescribes one; a sales tax payable account and no VAT; every account the owner''s to rename')
  on conflict (code) do nothing;

insert into chart_template_accounts (template, code, name, kind, parent_code, holds_money) values
  ('uk-plain', '1000', 'Bank current account', 'asset', null, true),
  ('uk-plain', '1010', 'Bank savings account', 'asset', null, true),
  ('uk-plain', '1020', 'Cash', 'asset', null, true),
  ('uk-plain', '1100', 'Trade debtors', 'asset', null, false),
  ('uk-plain', '1200', 'Stock', 'asset', null, false),
  ('uk-plain', '1300', 'Prepayments', 'asset', null, false),
  ('uk-plain', '1500', 'Equipment', 'asset', null, false),
  ('uk-plain', '1510', 'Equipment depreciation', 'asset', null, false),
  ('uk-plain', '2000', 'Trade creditors', 'liability', null, false),
  ('uk-plain', '2100', 'VAT control', 'liability', null, false),
  ('uk-plain', '2200', 'PAYE and National Insurance', 'liability', null, false),
  ('uk-plain', '2300', 'Corporation tax', 'liability', null, false),
  ('uk-plain', '2400', 'Accruals', 'liability', null, false),
  ('uk-plain', '2500', 'Deferred income', 'liability', null, false),
  ('uk-plain', '2600', 'Loans', 'liability', null, false),
  ('uk-plain', '2700', 'Credit card', 'liability', null, false),
  ('uk-plain', '2800', 'Director''s loan account', 'liability', null, false),
  ('uk-plain', '3000', 'Capital', 'equity', null, false),
  ('uk-plain', '3100', 'Retained earnings', 'equity', null, false),
  ('uk-plain', '3200', 'Drawings and dividends', 'equity', null, false),
  ('uk-plain', '4000', 'Sales', 'income', null, false),
  ('uk-plain', '4010', 'Delivery charged to customers', 'income', null, false),
  ('uk-plain', '4100', 'Discounts given', 'income', null, false),
  ('uk-plain', '4200', 'Other income', 'income', null, false),
  ('uk-plain', '4900', 'Exchange gains', 'income', null, false),
  ('uk-plain', '5000', 'Cost of goods sold', 'expense', null, false),
  ('uk-plain', '5010', 'Carriage inwards', 'expense', null, false),
  ('uk-plain', '5020', 'Payment processing fees', 'expense', null, false),
  ('uk-plain', '6000', 'Advertising and marketing', 'expense', null, false),
  ('uk-plain', '6100', 'Rent', 'expense', null, false),
  ('uk-plain', '6110', 'Utilities', 'expense', null, false),
  ('uk-plain', '6200', 'Software and subscriptions', 'expense', null, false),
  ('uk-plain', '6300', 'Postage and delivery', 'expense', null, false),
  ('uk-plain', '6400', 'Packaging', 'expense', null, false),
  ('uk-plain', '6500', 'Insurance', 'expense', null, false),
  ('uk-plain', '6600', 'Telephone and internet', 'expense', null, false),
  ('uk-plain', '6700', 'Travel', 'expense', null, false),
  ('uk-plain', '6800', 'Professional fees', 'expense', null, false),
  ('uk-plain', '6900', 'Bank charges', 'expense', null, false),
  ('uk-plain', '7000', 'Wages and salaries', 'expense', null, false),
  ('uk-plain', '7100', 'Depreciation', 'expense', null, false),
  ('uk-plain', '7200', 'Sundry expenses', 'expense', null, false),
  ('uk-plain', '7900', 'Exchange losses', 'expense', null, false),
  ('us-plain', '1000', 'Checking account', 'asset', null, true),
  ('us-plain', '1010', 'Savings account', 'asset', null, true),
  ('us-plain', '1020', 'Cash on hand', 'asset', null, true),
  ('us-plain', '1100', 'Accounts receivable', 'asset', null, false),
  ('us-plain', '1200', 'Inventory', 'asset', null, false),
  ('us-plain', '1300', 'Prepaid expenses', 'asset', null, false),
  ('us-plain', '1500', 'Equipment', 'asset', null, false),
  ('us-plain', '1510', 'Accumulated depreciation', 'asset', null, false),
  ('us-plain', '2000', 'Accounts payable', 'liability', null, false),
  ('us-plain', '2100', 'Sales tax payable', 'liability', null, false),
  ('us-plain', '2200', 'Payroll taxes payable', 'liability', null, false),
  ('us-plain', '2300', 'Income tax payable', 'liability', null, false),
  ('us-plain', '2400', 'Accrued expenses', 'liability', null, false),
  ('us-plain', '2500', 'Unearned revenue', 'liability', null, false),
  ('us-plain', '2600', 'Loans payable', 'liability', null, false),
  ('us-plain', '2700', 'Credit card', 'liability', null, false),
  ('us-plain', '2800', 'Due to owner', 'liability', null, false),
  ('us-plain', '3000', 'Owner''s equity', 'equity', null, false),
  ('us-plain', '3100', 'Retained earnings', 'equity', null, false),
  ('us-plain', '3200', 'Owner''s draws', 'equity', null, false),
  ('us-plain', '4000', 'Sales', 'income', null, false),
  ('us-plain', '4010', 'Shipping charged to customers', 'income', null, false),
  ('us-plain', '4100', 'Discounts given', 'income', null, false),
  ('us-plain', '4200', 'Other income', 'income', null, false),
  ('us-plain', '4900', 'Exchange gains', 'income', null, false),
  ('us-plain', '5000', 'Cost of goods sold', 'expense', null, false),
  ('us-plain', '5010', 'Freight-in', 'expense', null, false),
  ('us-plain', '5020', 'Merchant fees', 'expense', null, false),
  ('us-plain', '6000', 'Advertising and marketing', 'expense', null, false),
  ('us-plain', '6100', 'Rent', 'expense', null, false),
  ('us-plain', '6110', 'Utilities', 'expense', null, false),
  ('us-plain', '6200', 'Software and subscriptions', 'expense', null, false),
  ('us-plain', '6300', 'Shipping and postage', 'expense', null, false),
  ('us-plain', '6400', 'Packaging', 'expense', null, false),
  ('us-plain', '6500', 'Insurance', 'expense', null, false),
  ('us-plain', '6600', 'Phone and internet', 'expense', null, false),
  ('us-plain', '6700', 'Travel', 'expense', null, false),
  ('us-plain', '6800', 'Professional fees', 'expense', null, false),
  ('us-plain', '6900', 'Bank fees', 'expense', null, false),
  ('us-plain', '7000', 'Wages and salaries', 'expense', null, false),
  ('us-plain', '7100', 'Depreciation', 'expense', null, false),
  ('us-plain', '7200', 'Miscellaneous expenses', 'expense', null, false),
  ('us-plain', '7900', 'Exchange losses', 'expense', null, false)
  on conflict (template, code) do nothing;

-- Nomi's seven journals, as the CGNC template has them (0190, 0216): neither country prescribes any.
insert into chart_template_journals (template, code, name, kind) values
  ('uk-plain', 'SJ', 'Sales', 'sales'),
  ('uk-plain', 'PJ', 'Purchases', 'purchases'),
  ('uk-plain', 'BK', 'Bank', 'bank'),
  ('uk-plain', 'CS', 'Cash', 'cash'),
  ('uk-plain', 'GJ', 'General', 'general'),
  ('uk-plain', 'CL', 'Closing', 'closing'),
  ('uk-plain', 'OP', 'Opening balances', 'opening'),
  ('us-plain', 'SJ', 'Sales', 'sales'),
  ('us-plain', 'PJ', 'Purchases', 'purchases'),
  ('us-plain', 'BK', 'Bank', 'bank'),
  ('us-plain', 'CS', 'Cash', 'cash'),
  ('us-plain', 'GJ', 'General', 'general'),
  ('us-plain', 'CL', 'Closing', 'closing'),
  ('us-plain', 'OP', 'Opening balances', 'opening')
  on conflict (template, code) do nothing;

-- ── the identifiers the UK and US packs ask for ──────────────────────────────────────────────────────────────────────
-- The company number by R3's rule for GB (src/core/books/registry.ts: eight digits, or two capitals and six digits);
-- the EIN as the IRS writes it, two digits, a hyphen, seven digits. Stored only in that shape: the page normalises.
alter table businesses add column if not exists company_number text;
alter table businesses add column if not exists ein text;
alter table businesses drop constraint if exists businesses_company_number_shape;
alter table businesses add constraint businesses_company_number_shape
  check (company_number is null or company_number ~ '^([0-9]{8}|[A-Z]{2}[0-9]{6})$');
alter table businesses drop constraint if exists businesses_ein_shape;
alter table businesses add constraint businesses_ein_shape check (ein is null or ein ~ '^[0-9]{2}-[0-9]{7}$');

-- ── how long a US workspace's books are kept ─────────────────────────────────────────────────────────────────────────
insert into books_retention (country, years, law) values
  ('US', 7, 'Nomi''s own choice: seven years, the period commonly cited for United States federal tax records')
on conflict (country) do nothing;

insert into _migrations (version, name) values (225, 'books_country_packs')
  on conflict (version) do nothing;
