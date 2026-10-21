-- ---------------------------------------------------------------------------
-- 0194 — THE SHOP'S OWN QUICKBOOKS ONLINE (Phase 5, D9).
--
-- QuickBooks joins the systems the books are connected to (0179) and read from (0178), as Xero did (0193): its grant
-- sealed like every other, its connection's row, the records read from it. Its refresh token changes every 24 hours;
-- the one each refresh returns is kept as Xero's is (the old archived, never deleted). Its taxes are not read
-- (QuickBooks' tax rates name no account), so it needs no start days (0181).
-- ---------------------------------------------------------------------------

alter table connector_credentials drop constraint if exists connector_credentials_connector_check;
alter table connector_credentials add constraint connector_credentials_connector_check
  check (connector in ('apollo', 'sheets', 'odoo', 'xero', 'quickbooks'));

alter table books_connections drop constraint if exists books_connections_system_check;
alter table books_connections add constraint books_connections_system_check check (system in ('sheets', 'odoo', 'xero', 'quickbooks'));

alter table connector_records drop constraint if exists connector_records_system_check;
alter table connector_records add constraint connector_records_system_check check (system in ('excel', 'sheets', 'odoo', 'xero', 'quickbooks'));

insert into _migrations (version, name) values (194, 'quickbooks')
  on conflict (version) do nothing;
