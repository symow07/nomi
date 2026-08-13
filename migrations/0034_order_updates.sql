-- 0034 — M46: after the order.
--
-- The trail stopped at confirmation. `orders.status` has carried four states
-- since 0004 and nothing ever moved it off 'confirmed', so three weeks later
-- "where is my order?" was unanswerable — not because the answer is hard, but
-- because nobody wrote it down.
--
-- SHE SETS IT. NOTHING IS INFERRED. There is no rule anywhere that advances an
-- order because time passed or a lead time elapsed: an order is in production
-- when she says it is. Deriving it from a schedule would be a promise made by
-- arithmetic, and the buyer holds HER to it.
--
-- HISTORY, NOT JUST STATE. `order_updates` is append-only and is the record of
-- what she said and when. `orders.status` remains the CURRENT state, written in
-- the same transaction by the same function, because five read models already
-- read it and two sources that can drift is worse than one that is
-- materialised. `recordOrderUpdate` is the only writer of either; a test
-- asserts the two agree for every order.

create table if not exists order_updates (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  order_id     uuid not null references orders(id) on delete cascade,
  -- The same four words orders.status is constrained to. A state she invents
  -- cannot be reported to a buyer in his language; what she calls it in her
  -- own words goes in `note`, which is never sent.
  state        text not null check (state in ('pending_confirmation','confirmed','in_production','shipped','cancelled')),
  -- Hers. A note to herself, never sent to a buyer.
  note         text,
  -- A courier's reference, pasted. This product does not call a courier, does
  -- not validate the format, and does not know which carrier it belongs to.
  tracking_reference text,
  at           timestamptz not null default now(),
  by_actor     text not null default 'owner'
);

create index if not exists order_updates_latest
  on order_updates (order_id, at desc);

-- The tracking reference she last pasted, alongside the state, so a read model
-- answering "where is my order?" needs one row rather than a join.
alter table orders add column if not exists tracking_reference text;

alter table order_updates enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'order_updates' and policyname = 'order_updates_tenant') then
    create policy order_updates_tenant on order_updates
      for all to nomi_app
      using (business_id = current_business_id())
      with check (business_id = current_business_id());
  end if;
end $$;

-- Append-only: an edited history is not a history. She corrects the record by
-- adding to it, exactly as she does with her rate and her sample policy.
grant select, insert on order_updates to nomi_app;
revoke update on order_updates from nomi_app;

-- Every order that already exists gets its first entry, so the log is complete
-- rather than starting halfway through. `confirmed_at` is when she confirmed
-- it; `created_at` is the fallback for a row that never carried one.
insert into order_updates (business_id, order_id, state, at, by_actor)
select o.business_id, o.id, o.status, coalesce(o.confirmed_at, o.created_at), 'migration'
  from orders o
 where not exists (select 1 from order_updates u where u.order_id = o.id);

insert into _migrations (version, name)
values (34, 'order_updates')
on conflict (version) do nothing;
