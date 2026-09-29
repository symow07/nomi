-- 0081 · A product may have no minimum order (2026-09-29).
--
-- WHAT WAS WRONG. `products.moq` was `integer not null default 100`, a
-- leftover from export trade: a cosmetics brand or an online store has no
-- minimum order, and the column had no way to say so. An import whose line
-- stated no minimum wrote 100 and the review never showed it, so a customer
-- asking for one serum was refused as "below the minimum".
--
-- WHAT THIS IS. The column takes NULL, and NULL means "no minimum". The
-- default goes: a product states a minimum or it has none. Every reply, page
-- and export says "no minimum" in the owner's (or the customer's) language
-- where the minimum would go — never "minimum 1", never a blank, never
-- "null" (tests/parity/moq-no-minimum.test.ts).
--
-- EXISTING ROWS KEEP THEIR VALUES. Nothing records whether a stored 100 was
-- stated by the owner or written by the old default, so nothing is guessed:
-- the owner can clear it on the product's page.

alter table products alter column moq drop not null;
alter table products alter column moq drop default;
alter table products add constraint products_moq_positive check (moq is null or moq > 0) not valid;

comment on column products.moq is
  'The minimum order the owner stated, in the product''s unit; NULL means no minimum. Never 0, never a sentinel.';

insert into _migrations (version, name) values (81, 'moq_nullable')
on conflict (version) do nothing;
