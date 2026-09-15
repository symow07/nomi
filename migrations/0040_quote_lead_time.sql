-- ---------------------------------------------------------------------------
-- 0040 — G5: a quote records what it said about delivery.
--
-- WHAT WAS WRONG. During one of her closures (M44), the quote drops its lead
-- time and the reply guard makes a date unstateable. But the quote row kept no
-- lead time at all, so the buyer's proof page (M35) read the PRODUCT's lead
-- time instead and printed it — attributed to her catalogue — on the one page
-- a buyer forwards to his boss. The date M44 refused went out anyway, by the
-- side door. The owner's closed-card in the inbox had the opposite problem: it
-- re-derived the block from TODAY's closures, so a closure added after a date
-- was promised made the card say no date was promised.
--
-- WHAT THIS ADDS — two nullable columns, both written by `recordQuote`:
--
--   quotes.lead_time_days
--     The lead time the quote STATED. Null when it stated none — because her
--     closure withheld it, or because the product has none.
--
--   quotes.lead_time_withheld
--     {label, from, to}: HER closure, when it is the reason. Deliberately NOT
--     the date the lead time would have promised (`wouldShipOn`): that is the
--     one date that must never reach a buyer, so it is not stored where the
--     public page can select it.
--
-- EXISTING ROWS keep both null, and nothing is backfilled: whether an old quote
-- was inside a closure cannot be known after the fact, and guessing "the
-- product's lead time" would re-create the leak this migration exists to
-- close. An old quote's proof page therefore states no lead time. That is a
-- page saying less than it used to, which is the safe direction.
--
-- Additive and forward-only (ADR-0007): an older build ignores both columns.
-- ---------------------------------------------------------------------------

alter table quotes add column if not exists lead_time_days integer
  check (lead_time_days is null or lead_time_days >= 0);
alter table quotes add column if not exists lead_time_withheld jsonb;

insert into _migrations (version, name) values (40, 'quote_lead_time')
on conflict (version) do nothing;
