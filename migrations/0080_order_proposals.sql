-- 0080 · An order waits for the owner's tap, in every mode (2026-09-29, T6b).
--
-- WHAT WAS WRONG. A customer's bare "yes" to "shall I confirm?" created the
-- order, closed the conversation and sent "Your order is confirmed", with no
-- owner step, in every mode — drafts included — and without the disclosure. It
-- fired even when "shall I confirm?" was a draft the customer never saw,
-- because the pending question was saved with the turn whatever became of the
-- reply that asked it.
--
-- WHAT THIS IS. Two things, both on the send path.
--
-- 1. `order_proposals`. The customer's "yes" writes a PROPOSAL here: exactly
--    what they said yes to (the product, the quantity, the price, the total,
--    the e-mail, the owner's terms at that moment). Nothing is confirmed and
--    nothing is sent. The owner's tap creates the order (`orders`, through the
--    one order writer) and only then is the customer told; or the owner steps
--    into the conversation and the proposal is set aside. One waiting per
--    conversation.
--
-- 2. `asks` on `drafts` and `outbound_messages`: the question a reply asks the
--    customer ("shall I confirm?"). The conversation's pending question is set
--    when a message that asks one actually LEAVES (the provider accepted it),
--    never when a reply is merely written. A draft the owner changed asks
--    nothing that Nomi can know, so an edit carries no question.
--
-- ERASED WITH THE CUSTOMER (tools/erase-buyer.mjs rule `erase`): a proposal
-- holds their e-mail address and what they asked for; the order it became is
-- what stays, detached, like every order.

create table if not exists order_proposals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  conversation_id uuid not null references conversations(id),
  client_id uuid not null references clients(id),
  -- The customer's message that said yes.
  turn_message_id text,
  product_id uuid not null references products(id),
  quantity integer not null check (quantity > 0),
  unit text not null,
  unit_price numeric(12,4) not null check (unit_price > 0),
  total numeric(14,2) not null check (total > 0),
  currency text not null,
  client_email text not null,
  payment_terms text,
  incoterm text,
  -- pending     the owner has not decided
  -- confirmed   the owner tapped: `order_id` is the order it became
  -- set_aside   the owner stepped into the conversation instead
  state text not null default 'pending' check (state in ('pending', 'confirmed', 'set_aside')),
  order_id uuid references orders(id),
  decided_at timestamptz,
  decided_by text,
  created_at timestamptz not null default now(),
  constraint order_proposals_decided check ((state = 'pending') = (decided_at is null)),
  constraint order_proposals_confirmed check ((state = 'confirmed') = (order_id is not null))
);

create unique index if not exists order_proposals_one_pending
  on order_proposals (conversation_id) where state = 'pending';
create index if not exists order_proposals_business
  on order_proposals (business_id, state, created_at);
create index if not exists order_proposals_client
  on order_proposals (client_id);

alter table order_proposals enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'order_proposals' and policyname = 'order_proposals_tenant') then
    create policy order_proposals_tenant on order_proposals
      for all to nomi_app
      using (business_id = current_business_id())
      with check (business_id = current_business_id());
  end if;
end $$;

grant select, insert, update on order_proposals to nomi_app;
revoke delete, truncate on order_proposals from nomi_app;

alter table drafts
  add column if not exists asks text
    check (asks in ('product_confirmation', 'order_confirmation'));
comment on column drafts.asks is
  'The question this draft asks the customer, if any. Carried to the outbound message when the owner sends it unchanged; an edit carries none.';

alter table outbound_messages
  add column if not exists asks text
    check (asks in ('product_confirmation', 'order_confirmation'));
comment on column outbound_messages.asks is
  'The question this message asks the customer, if any. When the provider accepts it, the conversation''s pending question becomes this value.';

insert into _migrations (version, name) values (80, 'order_proposals')
on conflict (version) do nothing;
