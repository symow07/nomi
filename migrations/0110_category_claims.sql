-- 0110 — claims by product category (CK, the onboarding plan's phase 7a;
-- decision 42).
--
-- The claims net was shaped for export trade (CE, FDA, incoterms…) and missed
-- the riskiest things a beauty or clothing shop says: vegan, cruelty-free,
-- halal, organic, hypoallergenic, dermatologically tested, safe in pregnancy,
-- clears acne, 100% cotton, waterproof. Each is now a claim the reply guard
-- knows, refused unless the owner switched it on — a new kind of claim,
-- `product_attribute`, in the one table that holds those switches.
--
--   · claims_policy.kind gains 'product_attribute'.
--   · selling_answers.question gains 'product_claims' (How you sell asks it).
--   · businesses.product_category — what the owner says the shop sells
--     (cosmetics, apparel, or something else), picked on How you sell: it
--     decides which claims the owner is asked about. Null until picked.

alter table claims_policy drop constraint if exists claims_policy_kind_check;
alter table claims_policy add constraint claims_policy_kind_check
  check (kind in ('certification', 'incoterm', 'payment_terms', 'guarantee', 'shipping_method',
                  'compliance', 'delivery_promise', 'product_attribute'));

-- How you sell's new question (0096's list, extended; 0096 is never edited).
alter table selling_answers drop constraint if exists selling_answers_question_check;
alter table selling_answers add constraint selling_answers_question_check check (question in (
  'price', 'minimum', 'returns', 'delivery', 'payment', 'certifications', 'product_claims', 'hours', 'words',
  'offered', 'area', 'duration', 'next_step'));

alter table businesses add column if not exists product_category text
  check (product_category is null or product_category in ('cosmetics', 'apparel', 'other'));

insert into _migrations (version, name) values (110, 'category_claims')
on conflict (version) do nothing;
