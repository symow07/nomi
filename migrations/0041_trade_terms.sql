-- ---------------------------------------------------------------------------
-- 0041 — G6: the terms on her proforma are hers.
--
-- WHAT WAS WRONG. Every order was stamped "30% deposit, 70% before shipment"
-- by a literal in the turn pipeline, and every proforma said FOB from a
-- literal in the message catalogue. Neither came from the owner. A proforma is
-- the document a buyer pays against.
--
-- WHAT THIS ADDS:
--
--   trade_terms — her payment terms, in her own words, and the ONE delivery
--     term she puts on a proforma. HISTORY, NOT STATE, exactly as
--     sample_policy and owner_rates: stating new terms inserts, and the most
--     recent row is in force. An order confirmed in March is still explained
--     by the terms that were current then — which is why the order also keeps
--     its own copy (below). "She has not said" is the ABSENCE of a row.
--
--   orders.incoterm — the delivery term the order was confirmed under, beside
--     the `payment_terms` column orders have always had. Snapshotted when the
--     order is created, so changing her terms later does not rewrite a
--     document a buyer already holds.
--
-- The incoterm list is the claims guard's own (src/core/safety/claims.ts,
-- INCOTERM_KEYS): the term on her document and the term the guard recognises
-- in a reply are the same vocabulary.
--
-- Additive and forward-only (ADR-0007). Existing orders keep what they were
-- stamped with; nothing is rewritten.
-- ---------------------------------------------------------------------------

create table if not exists trade_terms (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references businesses(id) on delete cascade,
  payment_terms  text not null check (btrim(payment_terms) <> '' and length(payment_terms) <= 200),
  incoterm       text not null check (incoterm in ('EXW','FOB','CIF','CFR','DDP','DDU','DAP','FCA')),
  stated_at      timestamptz not null default now(),
  stated_by      text not null
);

create index if not exists trade_terms_current on trade_terms (business_id, stated_at desc);

alter table trade_terms enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'trade_terms' and policyname = 'trade_terms_tenant') then
    create policy trade_terms_tenant on trade_terms
      for all to nomi_app
      using (business_id = current_business_id())
      with check (business_id = current_business_id());
  end if;
end $$;

-- Insert-only, like every other statement of what she will honour: edited
-- terms are a promise that changes after it was given.
grant select, insert on trade_terms to nomi_app;
revoke update on trade_terms from nomi_app;

alter table orders add column if not exists incoterm text;

insert into _migrations (version, name) values (41, 'trade_terms')
on conflict (version) do nothing;
