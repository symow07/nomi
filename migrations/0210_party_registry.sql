-- ---------------------------------------------------------------------------
-- 0210 — A PARTY'S COMPANY REGISTRY NUMBER (Phase 5, R3; the owner, 2026-10-23).
--
-- The books carried a party's tax or VAT number (`tax_number`) and, for a Moroccan party, its ICE — never its
-- company registry number. Now `registry_number`, country-scoped, and two companions: `siret` (France only, optional)
-- and `registro_mercantil` (Spain only: the Registro / Tomo / Folio / Hoja entry, free text by nature, RRM art. 3).
-- Copied onto an invoice at issue and from it onto a credit note, frozen with the rest — never read again from the
-- party, so nothing done to a party later (a buyer's erasure least of all: a party is not a buyer, 0187) changes a
-- statutory document.
--
-- What the database holds (the hard rules; src/core/books/registry.ts holds the same and the soft warnings):
--   · FR  SIREN, nine digits ("9 chiffres", INSEE); SIRET fourteen digits, its first nine the SIREN.
--   · GB  Companies House number: eight digits, or two capitals and six digits. Any two capitals (the official
--         list of prefixes is incomplete). No check digit exists.
--   · ES  the NIF: nine characters, capitals and digits — its finer shape waits on the owner (docs/PHASE-5.md, R3).
--   · elsewhere: kept as typed, trimmed, at most 40 characters — no rule because no source.
--   · a French VAT number present ends with the SIREN; a Spanish one is ES and the NIF. Nothing ties a UK VAT number
--     to a company number. A missing VAT number is never wrong.
--   · NO checksum is enforced anywhere: INSEE publishes none for the SIREN, AEAT none for the NIF's control
--     character, and the UK number has none.
-- ---------------------------------------------------------------------------

alter table parties add column if not exists registry_number text;
alter table parties add column if not exists siret text;
alter table parties add column if not exists registro_mercantil text;
alter table parties drop constraint if exists parties_registry_shape;
alter table parties add constraint parties_registry_shape check (
  (registry_number is null or (length(registry_number) between 1 and 40 and registry_number = btrim(registry_number)))
  and (registry_number is null or country is distinct from 'FR' or registry_number ~ '^[0-9]{9}$')
  and (registry_number is null or country is distinct from 'GB' or registry_number ~ '^([0-9]{8}|[A-Z]{2}[0-9]{6})$')
  and (registry_number is null or country is distinct from 'ES' or registry_number ~ '^[0-9A-Z]{9}$'));
alter table parties drop constraint if exists parties_siret_shape;
alter table parties add constraint parties_siret_shape check (
  siret is null or (country is not distinct from 'FR' and siret ~ '^[0-9]{14}$' and registry_number is not null and left(siret, 9) = registry_number));
alter table parties drop constraint if exists parties_registro_shape;
alter table parties add constraint parties_registro_shape check (
  registro_mercantil is null or (country is not distinct from 'ES' and length(btrim(registro_mercantil)) between 1 and 200));
alter table parties drop constraint if exists parties_vat_matches_registry;
alter table parties add constraint parties_vat_matches_registry check (
  registry_number is null or tax_number is null
  or (country is distinct from 'FR' and country is distinct from 'ES')
  or (country = 'FR' and right(regexp_replace(upper(tax_number), '[^0-9A-Z]', '', 'g'), 9) = registry_number)
  or (country = 'ES' and regexp_replace(upper(tax_number), '[^0-9A-Z]', '', 'g') = 'ES' || registry_number));

alter table invoices
  add column if not exists party_registry_number text,
  add column if not exists party_siret text,
  add column if not exists party_registro_mercantil text;
alter table credit_notes
  add column if not exists party_registry_number text,
  add column if not exists party_siret text,
  add column if not exists party_registro_mercantil text;

-- invoices_rules, re-made from its latest definition (0187): the registry number, the SIRET and the Registro
-- Mercantil entry copied at issue with the rest.
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
    new.party_country := null; new.party_ice := null; new.party_tax_number := null; new.party_registry_number := null; new.party_siret := null; new.party_registro_mercantil := null;
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
    select code, name, address, country, ice, tax_number, registry_number, siret, registro_mercantil into p from parties where id = new.party_id and business_id = new.business_id;
    new.party_code := p.code; new.party_name := p.name; new.party_address := p.address;
    new.party_country := p.country; new.party_ice := p.ice; new.party_tax_number := p.tax_number;
    new.party_registry_number := p.registry_number; new.party_siret := p.siret; new.party_registro_mercantil := p.registro_mercantil;
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
    new.party_country := null; new.party_ice := null; new.party_tax_number := null; new.party_registry_number := null; new.party_siret := null; new.party_registro_mercantil := null;
  end if;
  return new;
end $$;

-- credit_notes_rules, re-made from its latest definition (0188): the same three copied from the invoice.
create or replace function credit_notes_rules() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n integer; ref text; e record; i record; l record; why text;
begin
  if tg_op = 'DELETE' then
    if old.state = 'issued' and not books_purge_allowed() then
      raise exception 'books: an issued credit note is never deleted' using errcode = 'NB022';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.state <> 'draft' or new.number is not null then
      raise exception 'books: a credit note is drafted, then issued' using errcode = 'NB022';
    end if;
    select state, currency into i from invoices where id = new.invoice_id;
    if i.state is distinct from 'issued' then
      raise exception 'books: a credit note is made against an issued invoice' using errcode = 'NB022';
    end if;
    if new.currency <> i.currency then
      raise exception 'books: a credit note is in its invoice''s currency (%)', i.currency using errcode = 'NB022';
    end if;
    new.party_code := null; new.party_name := null; new.party_address := null;
    new.party_country := null; new.party_ice := null; new.party_tax_number := null; new.party_registry_number := null; new.party_siret := null; new.party_registro_mercantil := null; new.receivable_book := null;
    return new;
  end if;
  if old.state = 'discarded' and not books_purge_allowed() then
    raise exception 'books: a discarded credit note stays discarded' using errcode = 'NB022';
  end if;
  if old.state = 'issued' then
    if books_purge_allowed() then return new; end if;
    if old.entry_id is null and new.entry_id is not null and new.receivable_book is not null
       and (to_jsonb(new) - 'entry_id' - 'receivable_book') = (to_jsonb(old) - 'entry_id' - 'receivable_book') then
      select state, document_ref into e from journal_entries where id = new.entry_id;
      ref := 'A-' || old.year || '-' || lpad(old.number::text, 4, '0');
      if e.state = 'posted' and e.document_ref = ref then return new; end if;
    end if;
    raise exception 'books: an issued credit note never changes' using errcode = 'NB022';
  end if;
  if new.state = 'issued' then
    if new.number is not null and new.number is distinct from old.number then
      raise exception 'books: a credit note''s number is the database''s to give, at issue' using errcode = 'NB022';
    end if;
    select * into i from invoices where id = new.invoice_id for update;
    if i.state is distinct from 'issued' then
      raise exception 'books: a credit note is made against an issued invoice' using errcode = 'NB022';
    end if;
    if new.issue_date < i.issue_date then
      raise exception 'books: a credit note is dated on or after its invoice (%)', i.issue_date using errcode = 'NB022';
    end if;
    if (select count(*) from credit_note_lines where credit_note_id = new.id) = 0 then
      raise exception 'books: a credit note is issued with its lines' using errcode = 'NB022';
    end if;
    for l in select * from credit_note_lines where credit_note_id = new.id loop
      why := credit_note_line_ok(new.id, l.line_no, l.invoice_line_no, l.quantity, l.net, l.tax);
      if why is not null then
        raise exception 'books: a credit note''s line — %', why using errcode = 'NB022';
      end if;
    end loop;
    new.party_code := i.party_code; new.party_name := i.party_name; new.party_address := i.party_address;
    new.party_country := i.party_country; new.party_ice := i.party_ice; new.party_tax_number := i.party_tax_number;
    new.party_registry_number := i.party_registry_number; new.party_siret := i.party_siret; new.party_registro_mercantil := i.party_registro_mercantil;
    new.year := extract(year from new.issue_date)::int;
    insert into credit_note_counters (business_id, year, last_number) values (new.business_id, new.year, 0)
      on conflict (business_id, year) do nothing;
    update credit_note_counters set last_number = last_number + 1 where business_id = new.business_id and year = new.year
      returning last_number into n;
    new.number := n;
    new.issued_at := now();
  else
    if new.number is not null then
      raise exception 'books: a draft has no number' using errcode = 'NB022';
    end if;
    new.party_code := null; new.party_name := null; new.party_address := null;
    new.party_country := null; new.party_ice := null; new.party_tax_number := null; new.party_registry_number := null; new.party_siret := null; new.party_registro_mercantil := null;
  end if;
  return new;
end $$;

insert into _migrations (version, name) values (210, 'party_registry')
  on conflict (version) do nothing;
