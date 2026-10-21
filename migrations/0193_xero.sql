-- ---------------------------------------------------------------------------
-- 0193 — THE SHOP'S OWN XERO (Phase 5, D8).
--
-- Xero joins the systems the books are connected to (0179) and read from (0178): its grant sealed like every other
-- (connector_credentials), its connection's row, the records read from it, and — Xero's tax rates having no start date,
-- as Odoo's have none — the day the owner confirms one took effect (0181).
--
-- Xero's refresh token ROTATES: each use returns the next and the one before stops working. A new grant is written
-- the way a connection is (the old one archived, never deleted), before the token is used — nothing new is needed in
-- the schema for it.
-- ---------------------------------------------------------------------------

alter table connector_credentials drop constraint if exists connector_credentials_connector_check;
alter table connector_credentials add constraint connector_credentials_connector_check
  check (connector in ('apollo', 'sheets', 'odoo', 'xero'));

alter table books_connections drop constraint if exists books_connections_system_check;
alter table books_connections add constraint books_connections_system_check check (system in ('sheets', 'odoo', 'xero'));

alter table connector_records drop constraint if exists connector_records_system_check;
alter table connector_records add constraint connector_records_system_check check (system in ('excel', 'sheets', 'odoo', 'xero'));

alter table tax_start_dates drop constraint if exists tax_start_dates_system_check;
alter table tax_start_dates add constraint tax_start_dates_system_check check (system in ('odoo', 'xero'));

insert into _migrations (version, name) values (193, 'xero')
  on conflict (version) do nothing;
