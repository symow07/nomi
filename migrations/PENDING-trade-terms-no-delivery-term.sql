-- ---------------------------------------------------------------------------
-- PENDING (the driver numbers it) — payment terms without a delivery term.
--
-- WHAT WAS WRONG (V1-537, the warmth run's re-audit). `trade_terms.incoterm`
-- is NOT NULL (0041), so the terms page refused "Save" until an Incoterm was
-- picked. A shop whose customers collect, or that delivers in its own area,
-- ships under no Incoterm, and could not record how its customers pay.
--
-- WHAT THIS CHANGES. The delivery term may be null: payment terms stated
-- alone. The CHECK stays as it is (a null passes it), so a term that IS
-- stated is still one of the claims guard's codes. Nothing else changes:
--   · orders.incoterm was nullable from the start (0041);
--   · the practice copies (0086 … 0095) copy the column as it is;
--   · the code (src/core/commerce/terms.ts) writes null only for "No delivery
--     term", allows no Incoterm claim for it, and makes no proforma without
--     one (src/api/web/orders.ts `proformaText`), so nothing a customer is
--     sent reads differently.
--
-- Until this is applied, saving terms without a delivery term fails at the
-- insert and the page says "Something went wrong"; saving with one works as
-- before. Additive and forward-only (ADR-0007): no row is rewritten.
-- ---------------------------------------------------------------------------

alter table trade_terms alter column incoterm drop not null;

-- insert into _migrations (version, name) values (NNNN, 'trade_terms_optional_incoterm')
-- on conflict (version) do nothing;
