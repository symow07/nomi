-- ---------------------------------------------------------------------------
-- 0093 — THE KINDS OF BUSINESS, FOR WHO NOMI IS FOR (the positioning rewrite,
-- 2026-09-30; docs/POSITIONING-INVENTORY.md "Sign-up and business profile").
--
-- Nomi is "for anyone who sells or talks to customers over social media":
-- brands, online stores, startups, agencies, as well as makers and exporters.
-- Two kinds join the eight of 0056 (never edited): 'online_shop' (a brand and
-- an online shop were one choice) and 'startup'. The order the form offers
-- them in is the code's; the check only names what may be stored. Every row
-- keeps its kind.
--
-- The languages served widen too (below).
-- ---------------------------------------------------------------------------

alter table businesses drop constraint businesses_kind_check;
alter table businesses add constraint businesses_kind_check check (kind is null or kind in (
  'brand', 'online_shop', 'retail', 'agency', 'services', 'startup',
  'manufacturer', 'trading', 'wholesale', 'other'));

-- And the languages a business serves: informational (nothing gates on it),
-- and a shop in São Paulo or Istanbul serves in its own. The nine languages
-- the safety checks read (rule 18); the owner's pages stay en / zh / ar.
alter table businesses drop constraint businesses_languages_served_check;
alter table businesses add constraint businesses_languages_served_check
  check (languages_served <@ array['en', 'zh', 'ar', 'es', 'fr', 'pt', 'de', 'tr', 'ru']);

insert into _migrations (version, name) values (93, 'business_kinds')
on conflict (version) do nothing;
