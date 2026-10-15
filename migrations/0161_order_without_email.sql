-- ---------------------------------------------------------------------------
-- 0161 — AN ORDER NEEDS NO E-MAIL (the owner, 2026-10-15).
--
-- "The pilot runs on WhatsApp. WhatsApp buyers do not hand over e-mail
-- addresses to place an order… And nothing in the system needs it: nothing
-- sends to it, the column is nullable, it's only printed [on the order card]."
-- The order gate's Rule 7 (an e-mail before any order, inherited from the old
-- system) is retired in code; `orders.client_email` was already nullable. The
-- proposal an order is made from (0080) required one: it no longer does.
-- ---------------------------------------------------------------------------

alter table order_proposals alter column client_email drop not null;

insert into _migrations (version, name) values (161, 'order_without_email')
  on conflict (version) do nothing;
