-- ---------------------------------------------------------------------------
-- 0216 — THE BOOKS' DISCLOSED LIMITS, LIFTED (docs/PHASE-5.md §10; the owner, 2026-10-26: "list 3 — all in 100%").
--
--   (f) THE OPENING ENTRY'S OWN JOURNAL: a journal of kind 'opening' (AN, à-nouveaux), which takes the opening entry
--       and nothing else — dated its fiscal year's first day, or the books' start day where the books began inside
--       that year (a mid-year start: one opening entry of balances). It keeps the opening entry's period
--       distinguishable, which Avis 24 §2.3 d)'s count relies on. The one write predicate (books_day_writable, 0211)
--       is unchanged: an opening entry is written like any other, while its day is after its year's lock.
--   (later sections of this file: a draft edited; a credit note that only lowers a price; a payment in another
--   currency; a bank CSV's columns mapped once, per bank; a party's registry number across the connectors)
-- ---------------------------------------------------------------------------

-- ── (f) the opening journal ─────────────────────────────────────────────────────────────────────────────────────
alter table journals drop constraint if exists journals_kind_check;
alter table journals add constraint journals_kind_check
  check (kind in ('sales', 'purchases', 'bank', 'cash', 'general', 'closing', 'opening'));
alter table chart_template_journals drop constraint if exists chart_template_journals_kind_check;
alter table chart_template_journals add constraint chart_template_journals_kind_check
  check (kind in ('sales', 'purchases', 'bank', 'cash', 'general', 'closing', 'opening'));

insert into chart_template_journals (template, code, name, kind) values ('cgnc-normal', 'AN', 'À-nouveaux', 'opening')
  on conflict (template, code) do nothing;

-- Every workspace that keeps books (it has journals) gets its opening journal, AN, where it has none of that kind and
-- the code is free. Named in the chart's own language: the CGNC's French for a Moroccan workspace.
insert into journals (business_id, code, name, kind)
select j.business_id, 'AN', case when b.country = 'MA' then 'À-nouveaux' else 'Opening balances' end, 'opening'
  from (select distinct business_id from journals) j join businesses b on b.id = j.business_id
 where not exists (select 1 from journals x where x.business_id = j.business_id and (x.kind = 'opening' or x.code = 'AN'));

-- The opening journal takes the opening entry and nothing else: dated its year's first day, or the books' start day
-- inside that year. Anything else in it is refused (NB027); the opening entry in any other journal is not looked for.
create or replace function opening_journal_rules() returns trigger
language plpgsql as $$
declare
  y record; started date;
begin
  if books_purge_allowed() then return new; end if;
  if (select kind from journals where id = new.journal_id) is distinct from 'opening' then return new; end if;
  select starts_on into y from fiscal_years where id = new.fiscal_year_id;
  select books_start into started from books_settings where business_id = new.business_id;
  if new.entry_date <> y.starts_on and (started is null or new.entry_date <> started) then
    raise exception 'books: the opening journal takes only the opening entry, dated its year''s first day (%) or the books'' start', y.starts_on
      using errcode = 'NB027';
  end if;
  return new;
end $$;
drop trigger if exists ab_opening_journal_rules on journal_entries;
create trigger ab_opening_journal_rules before insert or update on journal_entries for each row execute function opening_journal_rules();

-- ── (b) a credit note that only lowers a price ─────────────────────────────────────────────────────────────────
-- A credit note's line may now give nothing back and lower the price instead (a damage allowance, a discount after a
-- dispute): quantity 0, its net the amount lowered, its tax at the invoice line's rate. It can lower a line by no more
-- than is left of it, and no line of any kind may then take more than is left: a later return of the goods takes what
-- the price is now.
alter table credit_note_lines drop constraint if exists credit_note_lines_quantity_check;
alter table credit_note_lines add constraint credit_note_lines_quantity_check check (quantity >= 0);

-- credit_note_line_ok, re-made from its latest definition (0188): a line of quantity 0 is a price lowered; no line
-- takes more net than is left of the invoice's line; and what is left counts this note's other lines too.
create or replace function credit_note_line_ok(p_note uuid, p_line_no integer, p_inv_line integer, p_qty numeric, p_net numeric, p_tax numeric)
returns text language plpgsql stable as $$
declare
  n record; il record; done record; r numeric;
begin
  select invoice_id into n from credit_notes where id = p_note;
  select quantity, unit_price, net, tax, tax_code_id into il from invoice_lines where invoice_id = n.invoice_id and line_no = p_inv_line;
  if il is null then return 'it credits no line of its invoice'; end if;
  select coalesce(sum(l.quantity), 0) as q, coalesce(sum(l.net), 0) as net, coalesce(sum(l.tax), 0) as tax into done
    from credit_note_lines l join credit_notes c on c.id = l.credit_note_id
   where c.invoice_id = n.invoice_id and l.invoice_line_no = p_inv_line
     -- the notes issued, and this note's OTHER lines: a price lowered and goods returned in one note add up
     and ((c.state = 'issued' and c.id <> p_note) or (c.id = p_note and l.line_no <> p_line_no));
  r := coalesce((select rate from tax_codes where id = il.tax_code_id), 0);
  if p_net > il.net - done.net then
    return format('more than is left of the invoice''s line %s (%s)', p_inv_line, il.net - done.net);
  end if;
  if p_qty = 0 then
    if p_net <= 0 then return format('a price lowered on line %s is an amount above zero', p_inv_line); end if;
    -- all that is left of the line's price: exactly what is left of its tax; else its tax at the line's rate
    if p_net = il.net - done.net then
      if p_tax <> il.tax - done.tax then return format('the last of line %s takes exactly what is left: %s and tax %s', p_inv_line, il.net - done.net, il.tax - done.tax); end if;
    elsif p_tax <> round(p_net * r / 100, 2) then
      return format('line %s lowers the price at the invoice line''s tax, to the cent', p_inv_line);
    end if;
    return null;
  end if;
  if p_qty > il.quantity - done.q then
    return format('more than is left of the invoice''s line %s (%s)', p_inv_line, il.quantity - done.q);
  end if;
  if p_qty = il.quantity - done.q then
    if p_net <> il.net - done.net or p_tax <> il.tax - done.tax then
      return format('the last of line %s takes exactly what is left: %s and tax %s', p_inv_line, il.net - done.net, il.tax - done.tax);
    end if;
    return null;
  end if;
  if p_net <> round(p_qty * il.unit_price, 2) or p_tax <> round(p_net * r / 100, 2) then
    return format('line %s is its quantity at the invoice line''s price and tax, to the cent', p_inv_line);
  end if;
  return null;
end $$;

-- ── (c) a payment in another currency than the invoice ─────────────────────────────────────────────────────────
-- A customer billed in dollars pays in yuan (or the books' own money). The payment's entry has the bank's line in the
-- money that arrived and the receivable's in the invoice's; the difference between the two, at the owner's rates, is
-- the exchange gain or loss, a marked line of its own (0182). Such an entry cannot balance in each foreign currency on
-- its own — that is what crossing currencies means — so it is MARKED (`across_currencies`) and balances in the books'
-- currency only, on the converted amounts, as posting always checks (0173). Only a bank or cash journal takes the mark.
alter table journal_entries add column if not exists across_currencies boolean not null default false;

create or replace function across_currencies_rules() returns trigger
language plpgsql as $$
begin
  if books_purge_allowed() then return new; end if;
  if new.across_currencies and (select kind from journals where id = new.journal_id) not in ('bank', 'cash') then
    raise exception 'books: only a bank or cash entry settles across currencies' using errcode = 'NB028';
  end if;
  return new;
end $$;
drop trigger if exists ab_across_currencies_rules on journal_entries;
create trigger ab_across_currencies_rules before insert or update on journal_entries for each row execute function across_currencies_rules();

-- journal_entry_unbalanced, re-made from its latest definition (0173): an entry marked across currencies is not held
-- to each foreign currency on its own; its books'-currency balance is still posting's to check.
create or replace function journal_entry_unbalanced(p_entry uuid) returns text
language sql stable as $$
  select case
    when (select count(*) from journal_lines where entry_id = p_entry) < 2 then 'an entry needs two lines at least'
    when (select across_currencies from journal_entries where id = p_entry) then null
    else (select string_agg(format('%s: debits %s, credits %s', currency, d, c), '; ' order by currency)
            from (select l.currency, sum(l.debit) as d, sum(l.credit) as c from journal_lines l
                   join journal_entries e on e.id = l.entry_id
                   where l.entry_id = p_entry and l.currency <> books_currency(e.business_id) group by l.currency) t
           where d <> c)
  end
$$;

-- The payment keeps both: what it settles, in the invoice's currency (`currency`, `amount`, as before), and what
-- arrived (`paid_currency`, `paid_amount`) where that was another currency.
alter table invoice_payments add column if not exists paid_currency text;
alter table invoice_payments add column if not exists paid_amount numeric(18,2);
alter table invoice_payments drop constraint if exists invoice_payments_paid_across;
alter table invoice_payments add constraint invoice_payments_paid_across
  check ((paid_currency is null) = (paid_amount is null) and (paid_amount is null or paid_amount > 0)
         and (paid_currency is null or paid_currency <> currency));

-- ── (a) a draft edited ──────────────────────────────────────────────────────────────────────────────────────────
-- A draft entry, invoice or credit note is edited in place: its header updated (the rules already allow a draft's) and
-- its lines written again. The app role deletes nothing in the books, so the old lines go through this one door: only a
-- DRAFT of the viewer's own workspace, locked while its lines go, never by an accountant (DZ, 0200). Posted and issued
-- documents stay as they are: a posted entry is corrected by reversal, an issued invoice by a credit note.
create or replace function books_clear_draft(p_kind text, p_id uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b uuid := current_business_id();
begin
  if b is null then return false; end if;
  if viewer_is_accountant() then
    raise exception 'books: an accountant sees and exports the books; drafting is the owner''s' using errcode = 'NB021';
  end if;
  if p_kind = 'entry' then
    perform 1 from journal_entries where id = p_id and business_id = b and state = 'draft' for update;
    if not found then return false; end if;
    delete from journal_lines where entry_id = p_id and business_id = b;
  elsif p_kind = 'invoice' then
    perform 1 from invoices where id = p_id and business_id = b and state = 'draft' for update;
    if not found then return false; end if;
    delete from invoice_lines where invoice_id = p_id and business_id = b;
  elsif p_kind = 'credit_note' then
    perform 1 from credit_notes where id = p_id and business_id = b and state = 'draft' for update;
    if not found then return false; end if;
    delete from credit_note_lines where credit_note_id = p_id and business_id = b;
  else
    raise exception 'books: no such kind of draft: %', p_kind;
  end if;
  return true;
end $$;
revoke all on function books_clear_draft(text, uuid) from public;
grant execute on function books_clear_draft(text, uuid) to nomi_app;

-- ── (d) a bank's own CSV, its columns mapped once ───────────────────────────────────────────────────────────────
-- Which column of the bank's file is the day, the amount (or money out and money in), the currency, the wording and the
-- reference; the day's format and the decimal mark; the header row's names, by which a later file is recognised. Kept
-- on the bank account it was given for (one bank, one layout; a new answer replaces it), checked in full by the app
-- (`layoutOf`) before it is kept. The Nomi layout, OFX and CAMT.053 are read as before.
alter table accounts add column if not exists statement_layout jsonb;
alter table accounts drop constraint if exists accounts_statement_layout_shape;
alter table accounts add constraint accounts_statement_layout_shape
  check (statement_layout is null or (jsonb_typeof(statement_layout) = 'object' and length(statement_layout::text) <= 8000));

insert into _migrations (version, name) values (216, 'books_limits') on conflict (version) do nothing;
