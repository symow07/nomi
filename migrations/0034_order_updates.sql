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
-- WHICH OF THE TWO IS THE RECORD.
--
--   order_updates IS THE RECORD. Append-only, the app role cannot UPDATE it,
--     and every read that can reach it reads it — the buyer-facing state comes
--     from its head so the answer he gets and the record she keeps cannot
--     disagree.
--   orders.status IS A CACHE OF ITS HEAD, maintained in the same transaction
--     and never read where the log is available. It stays maintained rather
--     than abandoned because a column you stop writing goes stale and starts
--     LYING: 'confirmed' on an order that shipped three weeks ago looks
--     authoritative to whoever finds it next.
--
-- `db/orders.ts writeOrderState` is the only thing in the product that writes
-- either, and an integration test asserts they agree for every order after
-- every transition — it goes red the moment a second writer appears.

create table if not exists order_updates (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  order_id     uuid not null references orders(id) on delete cascade,
  -- The same FIVE words orders.status is constrained to
  -- (supabase/schema.sql: pending_confirmation, confirmed, in_production,
  -- shipped, cancelled). The owner is only ever OFFERED four of them —
  -- 'pending_confirmation' is a state the engine writes, not one she sets —
  -- but the column accepts what the column it caches accepts, so the backfill
  -- of an older order cannot be refused by its own log.
  --
  -- A state she invents cannot be reported to a buyer in his language; what
  -- she calls it in her own words goes in `note`, which is never sent.
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
