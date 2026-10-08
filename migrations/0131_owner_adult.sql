-- 0131 · AGE — the one who signed a business up said they are an adult (docs/PRE-LAUNCH.md item 1).
--
-- Sign-up asks the age, plainly, and refuses anyone under 18 (MIN_AGE in src/core/owner/signup.ts): signing up
-- agrees to terms for a business, and it keeps every child under COPPA's thirteen out. Only that the answer
-- passed is kept, and when: never the age. NULL for a workspace made before this, or by the operator.
--
-- Additive and forward-only (ADR-0007): an older build never writes it.

alter table businesses
  add column if not exists owner_adult_at timestamptz;

comment on column businesses.owner_adult_at is
  '0131 AGE: when the one who signed the business up gave an age of 18 or over. The age itself is not kept.';

insert into _migrations (version, name) values (131, 'owner_adult')
  on conflict (version) do nothing;
