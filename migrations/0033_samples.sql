-- 0033 — M45: samples.
--
-- "Can you send a sample?" is the second question in nearly every Yiwu
-- conversation, and the product had no answer at all — which does not mean a
-- language model has none. Asked that with nothing behind it, it answers
-- anyway: "samples are free, we just charge the courier" is plausible, helpful,
-- invented, and expensive every time a buyer holds her to it.
--
-- TWO ROWS, TWO OWNERS OF THE FACTS.
--
--   sample_policy   — hers. What a sample costs and whether it comes off the
--                     first order. Absent means she has not said; zero means
--                     free. Those are different answers and are stored
--                     differently.
--   sample_requests — the buyer's. That one asked, in his own words, with the
--                     address she captured from him.
--
-- The ADDRESS is not extracted from a message by anything. Pulling a shipping
-- address out of free text is a guess with a courier attached to it; this
-- column holds what the owner put in it.
--
-- NOT HERE, deliberately: courier accounts, shipping cost, tracking numbers.

-- HISTORY, NOT STATE, exactly as owner_rates: stating a new policy inserts,
-- and the most recent row is the one in force. A sample she quoted in March at
-- one price is still explained by the row that was current then.
create table if not exists sample_policy (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id) on delete cascade,
  -- 0 is a real answer and means FREE. NULL is not permitted: "she has not
  -- said" is the ABSENCE of a row, never a null inside one.
  price_amount  numeric(10,2) not null check (price_amount >= 0),
  currency      text not null default 'USD' check (currency in ('USD','CNY')),
  credited_on_first_order boolean not null,
  stated_at     timestamptz not null default now(),
  stated_by     text not null default 'owner'
);

create index if not exists sample_policy_current
  on sample_policy (business_id, stated_at desc);

create table if not exists sample_requests (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references businesses(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  -- The buyer's own words, verbatim. Not a summary: she decides what he meant.
  asked_text      text not null,
  requested_at    timestamptz not null default now(),
  -- Captured by the OWNER from the conversation. Never inferred.
  address         text,
  -- She has dealt with it. What "dealt with" means is hers; this product does
  -- not model a courier.
  handled_at      timestamptz,
  handled_by      text
);

create index if not exists sample_requests_open
  on sample_requests (business_id, requested_at desc)
  where handled_at is null;

-- One request per conversation: a buyer who asks twice is still one buyer
-- waiting for one sample, and two rows would read as two obligations.
create unique index if not exists sample_requests_one_per_conversation
  on sample_requests (conversation_id);

alter table sample_policy enable row level security;
alter table sample_requests enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'sample_policy' and policyname = 'sample_policy_tenant') then
    create policy sample_policy_tenant on sample_policy
      for all to nomi_app
      using (business_id = current_business_id())
      with check (business_id = current_business_id());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'sample_requests' and policyname = 'sample_requests_tenant') then
    create policy sample_requests_tenant on sample_requests
      for all to nomi_app
      using (business_id = current_business_id())
      with check (business_id = current_business_id());
  end if;
end $$;

-- Insert-only, like every other statement of what she will honour: an edited
-- sample price is a promise that changes value after it was given.
grant select, insert on sample_policy to nomi_app;
revoke update on sample_policy from nomi_app;

insert into _migrations (version, name)
values (33, 'samples')
on conflict (version) do nothing;
