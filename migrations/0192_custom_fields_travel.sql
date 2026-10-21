-- ---------------------------------------------------------------------------
-- 0192 — CUSTOM FIELDS TRAVEL WITH THE BOOKS (Phase 5, D7).
--
-- 0170 gave entries, lines and parties their custom values, checked against the owner's definitions. D7 lets the
-- owner define them on a page and carries them, with their definitions, through every way the books leave and come
-- back: the workbook, Google Sheets, Odoo. Three things change here:
--
--   · a definition is a record a connector reads and writes like the rest (connector_records' kind 'field');
--   · ONLY A PARTY'S FIELD CAN BE REQUIRED. Nomi writes entries of its own — an invoice issued, a payment, a bank
--     line matched, an exchange difference, a year's closing — and none of them can know a custom value; a required
--     entry or line field would stop every one of them. A party is always made by a person (the party form, a read-in),
--     who can give it;
--   · an accountant sees the definitions and changes none (0186's books_owner_acts, as on the rest of the books).
-- ---------------------------------------------------------------------------

alter table connector_records drop constraint if exists connector_records_kind_check;
alter table connector_records add constraint connector_records_kind_check
  check (kind in ('account', 'journal', 'party', 'tax_code', 'entry', 'field'));

alter table custom_field_defs drop constraint if exists custom_field_defs_required_party;
alter table custom_field_defs add constraint custom_field_defs_required_party
  check (not required or applies_to = 'party');

drop trigger if exists books_owner_acts on custom_field_defs;
create trigger books_owner_acts before insert or update or delete on custom_field_defs
  for each row execute function books_owner_acts();

insert into _migrations (version, name) values (192, 'custom_fields_travel')
  on conflict (version) do nothing;
