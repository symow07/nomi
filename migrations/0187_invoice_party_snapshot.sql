-- ---------------------------------------------------------------------------
-- 0187 — AN ISSUED INVOICE CARRIES ITS CUSTOMER AS THEY WERE AT ISSUE (Phase 5, D0; the owner, 2026-10-22).
--
-- An invoice is a document the shop must keep intact for ten years. Until now it held only a LINK to its party
-- (`invoices.party_id`), and every page read the party's name live: renaming the party in the books changed what an
-- issued invoice said, and the party had no address to show at all. Now, at issue, the database copies the party's
-- code, name, address, country, ICE and tax number ONTO the invoice. Frozen with the rest of it — 0184's rule refuses
-- any change to an issued invoice — and never read again from the party. A draft holds no copy (it is made at issue,
-- by the database, never by the app).
--
-- A party is the BOOKS' own record of a customer or supplier. It is NOT linked to a buyer (a conversation's
-- contact), on purpose: a buyer's erasure (CC-02, tools/erase-buyer.mjs) must never reach a statutory document. Do
-- not add that link. See docs/PHASE-5.md, "Decisions — a party is not a buyer".
--
-- Also: an invoice drafted from a Nomi order says which order (`source_order_id`), once per order while not
-- discarded — the order's sale goes through an invoice, with its customer, its tax and its receivable (D0.2). A
-- reference only, no foreign key: orders are kept or detached by the erasure rules, and an issued invoice never
-- changes because an order did.
-- ---------------------------------------------------------------------------

alter table parties add column if not exists address text check (address is null or length(btrim(address)) between 1 and 400);

alter table invoices
  add column if not exists party_code        text,
  add column if not exists party_name        text,
  add column if not exists party_address     text,
  add column if not exists party_country     text,
  add column if not exists party_ice         text,
  add column if not exists party_tax_number  text,
  add column if not exists source_order_id   uuid;

-- The invoices issued before this migration take their copy now, from their party as it stands (0184 shipped
-- nowhere but test databases: no production invoice exists). The rule is set aside for this one statement only.
alter table invoices disable trigger invoices_rules;
update invoices i set party_code = p.code, party_name = p.name, party_address = p.address, party_country = p.country,
                      party_ice = p.ice, party_tax_number = p.tax_number
  from parties p where p.id = i.party_id and i.state = 'issued' and i.party_name is null;
alter table invoices enable trigger invoices_rules;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_issued_with_party') then
    alter table invoices add constraint invoices_issued_with_party check (state <> 'issued' or (party_code is not null and party_name is not null));
  end if;
end $$;
create unique index if not exists invoices_one_per_order on invoices (business_id, source_order_id)
  where source_order_id is not null and state <> 'discarded';

-- invoices_rules, re-made from 0184 with the copy taken at issue.
create or replace function invoices_rules() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n integer; ref text; e record; p record;
begin
  if tg_op = 'DELETE' then
    if old.state = 'issued' and not books_purge_allowed() then
      raise exception 'books: an issued invoice is never deleted' using errcode = 'NB018';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.state <> 'draft' or new.number is not null then
      raise exception 'books: an invoice is drafted, then issued' using errcode = 'NB018';
    end if;
    -- the copy is the database's to take, at issue
    new.party_code := null; new.party_name := null; new.party_address := null;
    new.party_country := null; new.party_ice := null; new.party_tax_number := null;
    return new;
  end if;
  if old.state = 'discarded' and not books_purge_allowed() then
    raise exception 'books: a discarded invoice stays discarded' using errcode = 'NB018';
  end if;
  if old.state = 'issued' then
    if books_purge_allowed() then return new; end if;
    if old.entry_id is null and new.entry_id is not null
       and (to_jsonb(new) - 'entry_id') = (to_jsonb(old) - 'entry_id') then
      select state, document_ref into e from journal_entries where id = new.entry_id;
      ref := 'F-' || old.year || '-' || lpad(old.number::text, 4, '0');
      if e.state = 'posted' and e.document_ref = ref then return new; end if;
    end if;
    raise exception 'books: an issued invoice never changes — a correction is a credit note' using errcode = 'NB018';
  end if;
  if new.state = 'issued' then
    if new.number is not null and new.number is distinct from old.number then
      raise exception 'books: an invoice''s number is the database''s to give, at issue' using errcode = 'NB018';
    end if;
    if (select count(*) from invoice_lines where invoice_id = new.id) = 0 then
      raise exception 'books: an invoice is issued with its lines' using errcode = 'NB018';
    end if;
    select code, name, address, country, ice, tax_number into p from parties where id = new.party_id and business_id = new.business_id;
    new.party_code := p.code; new.party_name := p.name; new.party_address := p.address;
    new.party_country := p.country; new.party_ice := p.ice; new.party_tax_number := p.tax_number;
    new.year := extract(year from new.issue_date)::int;
    insert into invoice_counters (business_id, year, last_number) values (new.business_id, new.year, 0)
      on conflict (business_id, year) do nothing;
    update invoice_counters set last_number = last_number + 1 where business_id = new.business_id and year = new.year
      returning last_number into n;
    new.number := n;
    new.issued_at := now();
  else
    if new.number is not null then
      raise exception 'books: a draft has no number' using errcode = 'NB018';
    end if;
    new.party_code := null; new.party_name := null; new.party_address := null;
    new.party_country := null; new.party_ice := null; new.party_tax_number := null;
  end if;
  return new;
end $$;
revoke all on function invoices_rules() from public;

insert into _migrations (version, name) values (187, 'invoice_party_snapshot')
  on conflict (version) do nothing;
